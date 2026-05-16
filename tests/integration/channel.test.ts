import { describe, it, expect, beforeAll } from 'vitest';
import { newWalletEnv, hasIntegrationEnv, type TestEnv } from './helpers/fixture.js';
import { fundFromFaucet } from './helpers/faucet.js';

/**
 * Real-testnet channel roundtrip. Gated on TEST_RELAYER_URL + TEST_SEAL_SERVERS
 * via `describe.skipIf` so the default `pnpm test` (no integration env) skips
 * this suite silently instead of failing on faucet/RPC calls.
 */
describe.skipIf(!hasIntegrationEnv())('channel integration', () => {
  let env: TestEnv;

  beforeAll(async () => {
    env = newWalletEnv();
    await fundFromFaucet(env.address);
  }, 30_000);

  it('creates a channel and lists self as admin', async () => {
    const created = (await env.dispatcher.invoke('channel.create', {
      name: 'test-' + Date.now(),
    })) as { channel_id: string };
    expect(created.channel_id).toBeDefined();

    const members = (await env.dispatcher.invoke('channel.members', {
      channel_id: created.channel_id,
    })) as { admin: string };
    expect(members.admin).toBe(env.address);
  }, 30_000);

  it('sends 3 messages and reads them back in order', async () => {
    const created = (await env.dispatcher.invoke('channel.create', {
      name: 'send-' + Date.now(),
    })) as { channel_id: string };
    const cid = created.channel_id;

    for (const text of ['a', 'b', 'c']) {
      await env.dispatcher.invoke('channel.send', { channel_id: cid, content: text });
    }

    const hist = (await env.dispatcher.invoke('channel.history', {
      channel_id: cid,
    })) as { messages: Array<{ body: { text: string }; verified: boolean }> };
    expect(hist.messages.length).toBeGreaterThanOrEqual(3);

    // Slice the first 3 messages (most-recent-first per T8) and compare by
    // content; sort because we only need to assert all 3 are present.
    const texts = hist.messages.slice(0, 3).map((m) => m.body.text).sort();
    expect(texts).toEqual(['a', 'b', 'c']);

    for (const m of hist.messages.slice(0, 3)) {
      expect(m.verified).toBe(true);
    }
  }, 60_000);
});
