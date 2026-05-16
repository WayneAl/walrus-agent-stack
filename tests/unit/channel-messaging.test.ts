import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { sendTool, historyTool } from '../../src/tools/channel-messaging.js';
import type { SdkContext } from '../../src/sdk-client.js';
import type { Outbox } from '../../src/outbox.js';

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
} {
  const keypair = new Ed25519Keypair();
  const address = keypair.toSuiAddress();
  const messaging: MockMessaging = {
    sendMessage: vi.fn(async () => ({ messageId: 'msg-id-123' })),
    getMessages: vi.fn(async () => getMessagesResult ?? { messages: [], hasNext: false }),
  };
  const sdk = {
    keypair,
    config: { network: 'testnet' },
    client: { messaging },
  } as unknown as SdkContext;
  return { sdk, messaging, address };
}

describe('channel messaging tools', () => {
  it('both tools expose correct names and non-empty descriptions', () => {
    const { sdk } = makeMockSdk();
    const outbox = makeOutboxStub() as unknown as Outbox;
    const tools = [sendTool(sdk, outbox), historyTool(sdk)];
    expect(tools.map((t) => t.name)).toEqual(['channel.send', 'channel.history']);
    for (const t of tools) {
      expect(t.description).toBeTruthy();
    }
  });

  describe('channel.send', () => {
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
      expect(enqueued.tool).toBe('channel.send');
      expect(enqueued.args).toEqual(args);
      expect(typeof enqueued.id).toBe('string');
    });
  });

  describe('channel.history', () => {
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
      });
      expect(first.refs).toEqual(['walrus://blob/x']);

      // Plain message falls back to a synthesized envelope; refs is empty.
      const second = res.messages[1]!;
      expect(second.message_id).toBe('m2');
      expect(second.sender).toBe('0xbob');
      expect(second.verified).toBe(false);
      expect(second.body).toEqual({ type: 'text', text: 'just a plain string' });
      expect(second.refs).toEqual([]);
    });
  });
});
