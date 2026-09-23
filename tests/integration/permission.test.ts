import { describe, it, expect, beforeAll } from 'vitest';
import { newWalletEnv, hasIntegrationEnv, type TestEnv } from './helpers/fixture.js';
import { fundFromFaucet } from './helpers/faucet.js';

/**
 * Permission revoke flow: Alice kicks Bob; Bob's post-kick history read must
 * fail (or at minimum lose decrypt access to messages sent after the kick).
 * Gated like the other on-chain tests.
 */
describe.skipIf(!hasIntegrationEnv())('permission revoke', () => {
  let alice: TestEnv;
  let bob: TestEnv;

  beforeAll(async () => {
    alice = newWalletEnv();
    bob = newWalletEnv();
    await fundFromFaucet(alice.address);
    await fundFromFaucet(bob.address);
  }, 60_000);

  it('kicked member cannot read new messages', async () => {
    const c = (await alice.dispatcher.invoke('channel_create', {
      name: 'kick-' + Date.now(),
      members: [bob.address],
    })) as { channel_id: string };
    await alice.dispatcher.invoke('channel_send', {
      channel_id: c.channel_id,
      content: 'before-kick',
    });

    // Bob can read it
    const before = (await bob.dispatcher.invoke('channel_history', {
      channel_id: c.channel_id,
    })) as { messages: Array<{ body: { text: string } }> };
    expect(before.messages.some((m) => m.body.text === 'before-kick')).toBe(true);

    // Alice kicks Bob
    await alice.dispatcher.invoke('channel_kick', {
      channel_id: c.channel_id,
      address: bob.address,
    });

    // Alice sends new message
    await alice.dispatcher.invoke('channel_send', {
      channel_id: c.channel_id,
      content: 'after-kick',
    });

    // Bob tries to read new — should fail or not see new message.
    // Speculative error code shape — adjust after first real testnet run;
    // SDK doesn't document this path explicitly.
    await expect(
      bob.dispatcher.invoke('channel_history', { channel_id: c.channel_id }),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/MEMBERSHIP_REVOKED|CHANNEL_ACCESS_DENIED/),
    });
  }, 120_000);
});
