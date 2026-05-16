import { describe, it, expect, beforeAll } from 'vitest';
import { newWalletEnv, hasIntegrationEnv, type TestEnv } from './helpers/fixture.js';
import { fundFromFaucet } from './helpers/faucet.js';

/**
 * D2-mini cross-org flow: Alice creates a channel, invites Bob, both exchange
 * messages and Alice independently verifies Bob's signature. Gated like
 * channel/memory — skipped without TEST_RELAYER_URL + TEST_SEAL_SERVERS.
 */
describe.skipIf(!hasIntegrationEnv())('cross-org collaboration (D2 mini)', () => {
  let alice: TestEnv;
  let bob: TestEnv;
  let cid: string;

  beforeAll(async () => {
    alice = newWalletEnv();
    await fundFromFaucet(alice.address);
    bob = newWalletEnv();
    await fundFromFaucet(bob.address);
  }, 60_000);

  it('Alice creates, invites Bob, Bob joins and sees history', async () => {
    const c = (await alice.dispatcher.invoke('channel.create', {
      name: 'd2-' + Date.now(),
    })) as { channel_id: string };
    cid = c.channel_id;

    await alice.dispatcher.invoke('channel.send', { channel_id: cid, content: 'alice msg 1' });
    await alice.dispatcher.invoke('channel.invite', { channel_id: cid, address: bob.address });

    // Bob joins
    const j = (await bob.dispatcher.invoke('channel.join', { channel_id: cid })) as {
      history_count: number;
    };
    expect(j.history_count).toBeGreaterThanOrEqual(1);

    // Bob sends, Alice reads it back and verifies
    await bob.dispatcher.invoke('channel.send', { channel_id: cid, content: 'bob msg 1' });
    const hist = (await alice.dispatcher.invoke('channel.history', {
      channel_id: cid,
    })) as {
      messages: Array<{
        message_id: string;
        sender: string;
        verified: boolean;
        body: { text: string };
      }>;
    };
    const bobMsg = hist.messages.find((m) => m.body.text === 'bob msg 1');
    expect(bobMsg).toBeDefined();
    expect(bobMsg!.sender).toBe(bob.address);
    expect(bobMsg!.verified).toBe(true);

    const v = (await alice.dispatcher.invoke('identity.verify', {
      channel_id: cid,
      message_id: bobMsg!.message_id,
    })) as { verified: boolean; sender: string };
    expect(v.verified).toBe(true);
    expect(v.sender).toBe(bob.address);
  }, 120_000);
});
