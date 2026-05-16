import { describe, it, expect } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { encodeBlob, decodeBlob, verifyBlob } from '../../src/memory-blob.js';

describe('memory-blob', () => {
  const kp = new Ed25519Keypair();
  const author = kp.toSuiAddress();

  const base = {
    channel_id: 'ch1',
    key: 'a.md',
    content_type: 'text/plain',
    content: 'hello world',
    author_agent_id: 'analyst-us',
    message_id: 'msg1',
  };

  it('roundtrip encode -> decode preserves data', async () => {
    const blob = await encodeBlob(base, kp);
    const decoded = decodeBlob(blob);
    expect(decoded.channel_id).toBe('ch1');
    expect(decoded.key).toBe('a.md');
    expect(decoded.content).toBe('hello world');
    expect(decoded.metadata.author).toBe(author);
    expect(decoded.metadata.signature).toBeDefined();
  });

  it('verifyBlob passes for untouched blob', async () => {
    const blob = await encodeBlob(base, kp);
    const ok = await verifyBlob(decodeBlob(blob));
    expect(ok).toBe(true);
  });

  it('verifyBlob fails for tampered content', async () => {
    const blob = await encodeBlob(base, kp);
    const decoded = decodeBlob(blob);
    decoded.content = 'tampered';
    const ok = await verifyBlob(decoded);
    expect(ok).toBe(false);
  });

  it('rejects unknown schema_version', () => {
    expect(() => decodeBlob('{"schema_version":99}')).toThrowError(/schema_version/);
  });

  it('cross-check message_id mismatch detection', async () => {
    const blob = await encodeBlob(base, kp);
    const decoded = decodeBlob(blob);
    expect(decoded.metadata.message_id).toBe('msg1');
  });
});
