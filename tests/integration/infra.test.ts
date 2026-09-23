import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Dispatcher } from '../../src/mcp/dispatch.js';
import { Outbox } from '../../src/outbox.js';
import { sendTool } from '../../src/tools/channel-messaging.js';

/**
 * Relayer-offline outbox roundtrip. Fully mocked SDK — no real network — so
 * this runs in the default `pnpm test` without integration env gating.
 *
 * NOTE on the thrown error string: `isInfraError` in channel-messaging.ts
 * matches on substrings like `fetch failed` / `etimedout` / `econnrefused`,
 * NOT bare `timeout`. Throwing `new Error('fetch failed')` lands in the infra
 * branch (RELAYER_UNREACHABLE + outbox enqueue); a bare `timeout` would be
 * classified as a hard error and bypass the outbox.
 */
describe('relayer offline -> outbox', () => {
  it('queues send when SDK throws a transient network error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'infra-'));
    const outbox = new Outbox(dir);

    // Mock sdk whose sendMessage always fails with an infra-classified error.
    const sdk = {
      keypair: { toSuiAddress: () => '0xfake' },
      config: { home: dir },
      client: {
        messaging: {
          sendMessage: async () => {
            throw new Error('fetch failed');
          },
        },
      },
    } as unknown as Parameters<typeof sendTool>[0];

    const dispatcher = new Dispatcher();
    dispatcher.register(sendTool(sdk, outbox));

    await expect(
      dispatcher.invoke('channel_send', { channel_id: 'c', content: 'hi' }),
    ).rejects.toMatchObject({ code: 'RELAYER_UNREACHABLE' });

    expect(outbox.pending()).toHaveLength(1);
  });
});
