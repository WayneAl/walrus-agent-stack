import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  sendTool,
  historyTool,
  _resetSendLimitersForTests,
  _resetLoopDetectorForTests,
} from '../../src/tools/channel-messaging.js';
import type { SdkContext } from '../../src/sdk-client.js';
import type { Outbox } from '../../src/outbox.js';
import { setActiveChannel } from '../../src/session.js';

beforeEach(() => {
  // Module-level rate limiter + loop detector keep state across tests;
  // reset them so each case starts from a clean slate.
  _resetSendLimitersForTests();
});

interface MockMessaging {
  sendMessage: ReturnType<typeof vi.fn>;
  getMessages: ReturnType<typeof vi.fn>;
}

interface MockOutbox {
  enqueue: ReturnType<typeof vi.fn>;
  pending: ReturnType<typeof vi.fn>;
  markDone: ReturnType<typeof vi.fn>;
  incrementAttempt: ReturnType<typeof vi.fn>;
}

function makeOutboxStub(): MockOutbox {
  return {
    enqueue: vi.fn(),
    pending: vi.fn(() => []),
    markDone: vi.fn(),
    incrementAttempt: vi.fn(),
  };
}

function makeMockSdk(getMessagesResult?: unknown): {
  sdk: SdkContext;
  messaging: MockMessaging;
  address: string;
  home: string;
} {
  const home = mkdtempSync(join(tmpdir(), 'wa-msg-'));
  const keypair = new Ed25519Keypair();
  const address = keypair.toSuiAddress();
  const messaging: MockMessaging = {
    sendMessage: vi.fn(async () => ({ messageId: 'msg-id-123' })),
    getMessages: vi.fn(async () => getMessagesResult ?? { messages: [], hasNext: false }),
  };
  const sdk = {
    keypair,
    config: { network: 'testnet', home },
    client: { messaging },
  } as unknown as SdkContext;
  return { sdk, messaging, address, home };
}

describe('channel messaging tools', () => {
  it('both tools expose correct names and non-empty descriptions', () => {
    const { sdk } = makeMockSdk();
    const outbox = makeOutboxStub() as unknown as Outbox;
    const tools = [sendTool(sdk, outbox), historyTool(sdk)];
    expect(tools.map((t) => t.name)).toEqual(['channel_send', 'channel_history']);
    for (const t of tools) {
      expect(t.description).toBeTruthy();
    }
  });

  describe('channel_send', () => {
    let env: ReturnType<typeof makeMockSdk>;
    let outboxStub: MockOutbox;
    beforeEach(() => {
      env = makeMockSdk();
      outboxStub = makeOutboxStub();
    });

    it('forwards a serialized envelope to sendMessage with the channel uuid', async () => {
      const tool = sendTool(env.sdk, outboxStub as unknown as Outbox);
      const res = (await tool.handler({
        channel_id: 'uuid-send-1',
        content: 'hello world',
        refs: ['walrus://blob/abc', 'walrus://blob/def'],
        agent_id: 'agent-7',
        parent_message_id: 'parent-uuid-9',
        to: '0xb0b',
        intent: 'task',
      })) as {
        message_id: string;
        channel_id: string;
        sender: string;
        timestamp_ms: number;
      };

      expect(env.messaging.sendMessage).toHaveBeenCalledTimes(1);
      const call = env.messaging.sendMessage.mock.calls[0]![0];
      expect(call.signer).toBe(env.sdk.keypair);
      expect(call.groupRef).toEqual({ uuid: 'uuid-send-1' });
      expect(typeof call.text).toBe('string');
      // Attachments path is deliberately NOT used in T8 — refs travel in the envelope.
      expect(call.files).toBeUndefined();

      const body = JSON.parse(call.text);
      expect(body).toEqual({
        type: 'text',
        text: 'hello world',
        agent_id: 'agent-7',
        parent_message_id: 'parent-uuid-9',
        refs: ['walrus://blob/abc', 'walrus://blob/def'],
        to: '0xb0b',
        intent: 'task',
      });

      expect(res.message_id).toBe('msg-id-123');
      expect(res.channel_id).toBe('uuid-send-1');
      expect(res.sender).toBe(env.address);
      expect(typeof res.timestamp_ms).toBe('number');
      expect(res.timestamp_ms).toBeGreaterThan(0);
    });

    it('defaults optional fields when omitted', async () => {
      const tool = sendTool(env.sdk, outboxStub as unknown as Outbox);
      await tool.handler({
        channel_id: 'uuid-send-2',
        content: 'no extras',
      });
      const call = env.messaging.sendMessage.mock.calls[0]![0];
      const body = JSON.parse(call.text);
      expect(body).toEqual({
        type: 'text',
        text: 'no extras',
        agent_id: null,
        parent_message_id: null,
        refs: [],
        to: null,
        intent: null,
      });
    });

    it('defaults channel_id to the active channel', async () => {
      setActiveChannel(env.home, 'uuid-active');
      const tool = sendTool(env.sdk, outboxStub as unknown as Outbox);
      const res = (await tool.handler({ content: 'hi' })) as { channel_id: string };
      expect(res.channel_id).toBe('uuid-active');
      expect(env.messaging.sendMessage.mock.calls[0]![0].groupRef).toEqual({ uuid: 'uuid-active' });
    });

    it('throws NO_ACTIVE_CHANNEL without channel_id or an active channel', async () => {
      const tool = sendTool(env.sdk, outboxStub as unknown as Outbox);
      await expect(tool.handler({ content: 'hi' })).rejects.toMatchObject({
        code: 'NO_ACTIVE_CHANNEL',
      });
      expect(env.messaging.sendMessage).not.toHaveBeenCalled();
    });

    it('throws RATE_LIMITED on the 11th send within the window and does not enqueue', async () => {
      const tool = sendTool(env.sdk, outboxStub as unknown as Outbox);
      // Both limiters share the same `${channel_id}:${sender}` key, and the
      // loop detector trips at 5 consecutive same-key sends. To isolate the
      // rate limiter's 10/min cap, reset just the loop detector between
      // sends — leaves the rate limiter's window untouched.
      for (let i = 0; i < 10; i++) {
        await tool.handler({ channel_id: 'uuid-rl', content: `msg-${i}` });
        _resetLoopDetectorForTests();
      }
      // 11th must be rejected by the rate limiter (not by the loop detector,
      // which we just reset). The throw must NOT enqueue to the outbox.
      await expect(
        tool.handler({ channel_id: 'uuid-rl', content: 'overflow' }),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      expect(env.messaging.sendMessage).toHaveBeenCalledTimes(10);
      expect(outboxStub.enqueue).not.toHaveBeenCalled();
    });

    describe('loop detector', () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it('throws LOOP_DETECTED on the 20th consecutive send, not before', async () => {
        // Space sends 7 s apart so the 10/min rate limiter never fires; any
        // throw is then the loop detector. It must NOT enqueue to the outbox.
        vi.useFakeTimers();
        const tool = sendTool(env.sdk, outboxStub as unknown as Outbox);
        for (let i = 0; i < 19; i++) {
          await tool.handler({ channel_id: 'uuid-ld', content: `streak-${i}` });
          vi.advanceTimersByTime(7_000);
        }
        await expect(
          tool.handler({ channel_id: 'uuid-ld', content: 'streak-19' }),
        ).rejects.toMatchObject({ code: 'LOOP_DETECTED' });
        expect(env.messaging.sendMessage).toHaveBeenCalledTimes(19);
        expect(outboxStub.enqueue).not.toHaveBeenCalled();
      });
    });

    it('queues to outbox and throws RELAYER_UNREACHABLE when sendMessage hits an infra error', async () => {
      env.messaging.sendMessage.mockImplementationOnce(async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:3000');
      });
      const tool = sendTool(env.sdk, outboxStub as unknown as Outbox);
      const args = {
        channel_id: 'uuid-send-3',
        content: 'queue me',
        refs: ['walrus://blob/x'],
        agent_id: 'agent-q',
        parent_message_id: 'parent-q',
      };
      await expect(tool.handler(args)).rejects.toMatchObject({
        code: 'RELAYER_UNREACHABLE',
      });
      expect(outboxStub.enqueue).toHaveBeenCalledTimes(1);
      const enqueued = outboxStub.enqueue.mock.calls[0]![0];
      expect(enqueued.tool).toBe('channel_send');
      expect(enqueued.args).toEqual(args);
      expect(typeof enqueued.id).toBe('string');
    });

    it('queues and reports WALRUS_UNAVAILABLE for a transport Walrus failure', async () => {
      env.messaging.sendMessage.mockImplementationOnce(async () => {
        throw Object.assign(new Error('Walrus upload failed: 500'), {
          status: 503,
          code: 'WALRUS_UNAVAILABLE',
        });
      });
      const tool = sendTool(env.sdk, outboxStub as unknown as Outbox);
      await expect(tool.handler({ channel_id: 'uuid-w', content: 'x' })).rejects.toMatchObject({
        code: 'WALRUS_UNAVAILABLE',
      });
      expect(outboxStub.enqueue).toHaveBeenCalledTimes(1);
    });

    it('does not queue permission errors (403)', async () => {
      env.messaging.sendMessage.mockImplementationOnce(async () => {
        throw Object.assign(new Error('Not a sender'), { status: 403, code: 'NOT_GROUP_MEMBER' });
      });
      const tool = sendTool(env.sdk, outboxStub as unknown as Outbox);
      await expect(tool.handler({ channel_id: 'uuid-p', content: 'x' })).rejects.toMatchObject({
        status: 403,
      });
      expect(outboxStub.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('channel_history', () => {
    it('passes limit and afterOrder when since is provided', async () => {
      const env = makeMockSdk({ messages: [], hasNext: false });
      const tool = historyTool(env.sdk);
      await tool.handler({ channel_id: 'uuid-hist-1', since: 42, limit: 25 });
      expect(env.messaging.getMessages).toHaveBeenCalledTimes(1);
      const call = env.messaging.getMessages.mock.calls[0]![0];
      expect(call.signer).toBe(env.sdk.keypair);
      expect(call.groupRef).toEqual({ uuid: 'uuid-hist-1' });
      expect(call.limit).toBe(25);
      expect(call.afterOrder).toBe(42);
    });

    it('omits afterOrder when since is undefined', async () => {
      const env = makeMockSdk({ messages: [], hasNext: false });
      const tool = historyTool(env.sdk);
      await tool.handler({ channel_id: 'uuid-hist-2', limit: 100 });
      const call = env.messaging.getMessages.mock.calls[0]![0];
      expect(call.afterOrder).toBeUndefined();
      expect(call.limit).toBe(100);
    });

    it('maps envelope-shaped messages and falls back for plain text', async () => {
      const envelopeMsg = {
        messageId: 'm1',
        groupId: 'g1',
        order: 5,
        text: JSON.stringify({
          type: 'text',
          text: 'envelope hi',
          agent_id: 'agent-A',
          parent_message_id: null,
          refs: ['walrus://blob/x'],
          to: '0xb0b',
          intent: 'result',
        }),
        senderAddress: '0xalice',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        isEdited: false,
        isDeleted: false,
        attachments: [],
        senderVerified: true,
      };
      const plainMsg = {
        messageId: 'm2',
        groupId: 'g1',
        order: 6,
        text: 'just a plain string',
        senderAddress: '0xbob',
        createdAt: 1700000001000,
        updatedAt: 1700000001000,
        isEdited: false,
        isDeleted: false,
        attachments: [],
        senderVerified: false,
      };
      const env = makeMockSdk({ messages: [envelopeMsg, plainMsg], hasNext: true });
      const tool = historyTool(env.sdk);
      const res = (await tool.handler({ channel_id: 'uuid-hist-3', limit: 100 })) as {
        channel_id: string;
        messages: Array<{
          message_id: string;
          sender: string;
          timestamp_ms: number;
          verified: boolean;
          order: number;
          body: { type: 'text'; text: string; agent_id?: string | null; refs?: string[] };
          refs: string[];
          to: string | null;
          intent: string | null;
        }>;
        has_next: boolean;
      };

      expect(res.channel_id).toBe('uuid-hist-3');
      expect(res.has_next).toBe(true);
      expect(res.messages).toHaveLength(2);

      // Envelope message decodes back to its parsed shape and exposes refs at top level.
      const first = res.messages[0]!;
      expect(first.message_id).toBe('m1');
      expect(first.sender).toBe('0xalice');
      expect(first.timestamp_ms).toBe(1700000000000);
      expect(first.verified).toBe(true);
      expect(first.order).toBe(5);
      expect(first.body).toEqual({
        type: 'text',
        text: 'envelope hi',
        agent_id: 'agent-A',
        parent_message_id: null,
        refs: ['walrus://blob/x'],
        to: '0xb0b',
        intent: 'result',
      });
      expect(first.refs).toEqual(['walrus://blob/x']);
      expect(first.to).toBe('0xb0b');
      expect(first.intent).toBe('result');

      // Plain message falls back to a synthesized envelope; refs is empty.
      const second = res.messages[1]!;
      expect(second.message_id).toBe('m2');
      expect(second.sender).toBe('0xbob');
      expect(second.verified).toBe(false);
      expect(second.body).toEqual({ type: 'text', text: 'just a plain string' });
      expect(second.refs).toEqual([]);
      expect(second.to).toBeNull();
      expect(second.intent).toBeNull();
    });
  });
});
