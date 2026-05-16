import { describe, it, expect } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { encodeBlob, decodeBlob, verifyBlob } from '../../src/memory-blob.js';

/**
 * Pure-crypto tamper test — exercises the memory-blob signature path without
 * any network/SDK access, so it runs as a normal unit-style test in the
 * default `pnpm test` (no `skipIf` needed).
 */
describe('blob tamper detection', () => {
  it('detects modified content', async () => {
    const kp = new Ed25519Keypair();
    const blob = await encodeBlob(
      {
        channel_id: 'c',
        key: 'k',
        content_type: 'text/plain',
        content: 'original',
        message_id: 'm1',
      },
      kp,
    );
    const decoded = decodeBlob(blob);
    decoded.content = 'tampered';
    expect(await verifyBlob(decoded)).toBe(false);
  });
});
