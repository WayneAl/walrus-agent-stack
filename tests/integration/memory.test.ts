import { describe, it, expect, beforeAll } from 'vitest';
import { newWalletEnv, hasIntegrationEnv, type TestEnv } from './helpers/fixture.js';
import { fundFromFaucet } from './helpers/faucet.js';

/**
 * Real-testnet memory write/read roundtrip. Same gating rationale as
 * channel.test.ts — skipped by default unless TEST_RELAYER_URL +
 * TEST_SEAL_SERVERS are set.
 */
describe.skipIf(!hasIntegrationEnv())('memory integration', () => {
  let env: TestEnv;
  let cid: string;

  beforeAll(async () => {
    env = newWalletEnv();
    await fundFromFaucet(env.address);
    const created = (await env.dispatcher.invoke('channel.create', {
      name: 'mem-' + Date.now(),
    })) as { channel_id: string };
    cid = created.channel_id;
  }, 30_000);

  it('writes and reads memory', async () => {
    const w = (await env.dispatcher.invoke('memory.write', {
      channel_id: cid,
      key: 'note.md',
      content: 'this is a note',
    })) as { uri: string };
    expect(w.uri).toMatch(/^walrus:\/\//);

    const r = (await env.dispatcher.invoke('memory.read', { uri: w.uri })) as {
      content: string;
      verified: boolean;
      author: string;
    };
    expect(r.content).toBe('this is a note');
    expect(r.verified).toBe(true);
    expect(r.author).toBe(env.address);
  }, 60_000);
});
