import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { joinTool, waitTool } from '../../src/tools/channel-subscribe.js';
import type { SdkContext } from '../../src/sdk-client.js';
import { getCursor, readSession, setActiveChannel, setCursor } from '../../src/session.js';

interface FakeMsg {
  messageId: string;
  order: number;
  text: string;
  senderAddress: string;
  createdAt: number;
  senderVerified: boolean;
  attachments: unknown[];
}

function msg(order: number, sender: string, text = `m${order}`): FakeMsg {
  return {
    messageId: String(order),
    order,
    text: JSON.stringify({ type: 'text', text, refs: [], to: '*', intent: 'chat' }),
    senderAddress: sender,
    createdAt: 1_700_000_000_000 + order,
    senderVerified: true,
    attachments: [],
  };
}

/**
 * Fake channel log with the transport's window semantics: ascending,
 * order > afterOrder, truncated to limit, hasNext when more remain.
 */
function makeEnv() {
  const home = mkdtempSync(join(tmpdir(), 'wa-sub-'));
  const keypair = new Ed25519Keypair();
  const me = keypair.toSuiAddress();
  const log: FakeMsg[] = [];
  const getMessages = vi.fn(
    async (o: { afterOrder?: number; limit?: number; groupRef: { uuid: string } }) => {
      const after = o.afterOrder ?? -Infinity;
      const window = log.filter((m) => m.order > after);
      const limit = o.limit ?? 50;
      return { messages: window.slice(0, limit), hasNext: window.length > limit };
    },
  );
  const sdk = {
    keypair,
    config: { network: 'testnet', home },
    client: { messaging: { getMessages } },
  } as unknown as SdkContext;
  return { sdk, home, me, log, getMessages };
}

/** Fake clock: `sleep` advances `now`, optionally running a hook per tick. */
function fakeClock(onSleep?: () => void) {
  let t = 0;
  return {
    now: () => t,
    sleep: vi.fn(async (ms: number) => {
      t += ms;
      onSleep?.();
    }),
  };
}

describe('channel_join', () => {
  it('exposes correct name and non-empty description', () => {
    const tool = joinTool(makeEnv().sdk);
    expect(tool.name).toBe('channel_join');
    expect(tool.description).toBeTruthy();
  });

  it('sets the active channel, returns the 20 newest messages, cursor at the newest order', async () => {
    const env = makeEnv();
    for (let i = 0; i < 130; i++) env.log.push(msg(i, '0xa11ce'));
    const res = (await joinTool(env.sdk).handler({ channel_id: 'chan-j' })) as {
      channel_id: string;
      joined_as: string;
      history_count: number;
      messages: { order: number; to: string; intent: string }[];
    };
    expect(res.channel_id).toBe('chan-j');
    expect(res.joined_as).toBe(env.me);
    expect(res.history_count).toBe(130);
    expect(res.messages.map((m) => m.order)).toEqual(Array.from({ length: 20 }, (_, i) => 110 + i));
    expect(res.messages[0]!.to).toBe('*');
    expect(res.messages[0]!.intent).toBe('chat');
    expect(readSession(env.home).active_channel_id).toBe('chan-j');
    expect(getCursor(env.home, 'chan-j')).toBe(129);
    // First page has no afterOrder (orders may start at 0), second pages from 99.
    expect(env.getMessages.mock.calls[0]![0].afterOrder).toBeUndefined();
    expect(env.getMessages.mock.calls[1]![0].afterOrder).toBe(99);
  });

  it('empty channel stores a from-the-start (null) cursor', async () => {
    const env = makeEnv();
    const res = (await joinTool(env.sdk).handler({ channel_id: 'chan-e' })) as {
      messages: unknown[];
    };
    expect(res.messages).toEqual([]);
    expect(getCursor(env.home, 'chan-e')).toBeNull();
  });
});

describe('channel_wait', () => {
  it('times out with no messages when nothing new arrives', async () => {
    const env = makeEnv();
    setActiveChannel(env.home, 'chan-w');
    setCursor(env.home, 'chan-w', null);
    const clock = fakeClock();
    const tool = waitTool(env.sdk, { pollMs: 3000, ...clock });
    const res = (await tool.handler({ timeout_s: 10, include_own: false })) as {
      channel_id: string;
      messages: unknown[];
      timed_out: boolean;
    };
    expect(res).toEqual({ channel_id: 'chan-w', messages: [], timed_out: true });
    expect(clock.sleep).toHaveBeenCalledTimes(3);
    expect(clock.now()).toBeLessThanOrEqual(10_000);
  });

  it("returns only others' messages, skipping (but consuming) own ones, and advances the cursor", async () => {
    const env = makeEnv();
    env.log.push(msg(0, '0xa11ce'));
    setCursor(env.home, 'chan-w', 0);
    // Own message arrives first; the peer's reply arrives on the next poll.
    env.log.push(msg(1, env.me));
    const clock = fakeClock(() => {
      if (env.log.length === 2) env.log.push(msg(2, '0xb0b', 'answer'));
    });
    const tool = waitTool(env.sdk, { pollMs: 3000, ...clock });
    const res = (await tool.handler({ channel_id: 'chan-w', timeout_s: 45, include_own: false })) as {
      messages: { order: number; sender: string; body: { text: string } }[];
      timed_out: boolean;
    };
    expect(res.timed_out).toBe(false);
    expect(res.messages.map((m) => m.order)).toEqual([2]);
    expect(res.messages[0]!.sender).toBe('0xb0b');
    expect(res.messages[0]!.body.text).toBe('answer');
    expect(getCursor(env.home, 'chan-w')).toBe(2);
    // Polls resumed from the advanced cursor, never from 0 again.
    const afters = env.getMessages.mock.calls.map((c) => c[0].afterOrder);
    expect(afters).toEqual([0, 1]);

    // A second wait sees nothing already delivered.
    const again = (await tool.handler({ channel_id: 'chan-w', timeout_s: 1, include_own: false })) as {
      messages: unknown[];
      timed_out: boolean;
    };
    expect(again).toMatchObject({ messages: [], timed_out: true });
  });

  it('include_own returns own messages too', async () => {
    const env = makeEnv();
    setCursor(env.home, 'chan-w', null);
    env.log.push(msg(0, env.me));
    const tool = waitTool(env.sdk, { pollMs: 3000, ...fakeClock() });
    const res = (await tool.handler({ channel_id: 'chan-w', timeout_s: 5, include_own: true })) as {
      messages: { order: number }[];
    };
    expect(res.messages.map((m) => m.order)).toEqual([0]);
    expect(getCursor(env.home, 'chan-w')).toBe(0);
  });

  it('with no stored cursor, starts at the current tail (future messages only)', async () => {
    const env = makeEnv();
    env.log.push(msg(0, '0xa11ce'), msg(1, '0xa11ce'));
    const tool = waitTool(env.sdk, { pollMs: 3000, ...fakeClock() });
    const res = (await tool.handler({ channel_id: 'chan-n', timeout_s: 1, include_own: false })) as {
      messages: unknown[];
      timed_out: boolean;
    };
    expect(res).toMatchObject({ messages: [], timed_out: true });
    expect(getCursor(env.home, 'chan-n')).toBe(1);
  });

  it('throws NO_ACTIVE_CHANNEL without channel_id or an active channel', async () => {
    const env = makeEnv();
    const tool = waitTool(env.sdk, { pollMs: 3000, ...fakeClock() });
    await expect(tool.handler({ timeout_s: 1, include_own: false })).rejects.toMatchObject({
      code: 'NO_ACTIVE_CHANNEL',
    });
  });
});
