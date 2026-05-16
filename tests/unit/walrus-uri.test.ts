import { describe, it, expect } from 'vitest';
import { parseWalrusUri, buildWalrusUri } from '../../src/walrus-uri.js';

describe('walrus-uri', () => {
  it('parses bare uri', () => {
    expect(parseWalrusUri('walrus://blobABC123')).toEqual({
      blobId: 'blobABC123',
    });
  });

  it('parses uri with channel + key hints', () => {
    expect(parseWalrusUri('walrus://blobABC?channel=chan1&key=analyst-us%2Ffindings.md')).toEqual({
      blobId: 'blobABC',
      channel: 'chan1',
      key: 'analyst-us/findings.md',
    });
  });

  it('builds uri', () => {
    expect(buildWalrusUri('blob1', 'ch1', 'k/v.md')).toBe(
      'walrus://blob1?channel=ch1&key=k%2Fv.md',
    );
  });

  it('rejects non-walrus uri', () => {
    expect(() => parseWalrusUri('http://x')).toThrowError(/walrus/);
  });
});
