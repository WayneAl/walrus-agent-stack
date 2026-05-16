import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  beforeEach(() => {
    delete process.env.SUI_PRIVATE_KEY;
    delete process.env.SUI_NETWORK;
  });

  it('throws if SUI_PRIVATE_KEY is missing', () => {
    expect(() => loadConfig({})).toThrowError(/SUI_PRIVATE_KEY/);
  });

  it('defaults network to testnet', () => {
    const cfg = loadConfig({ SUI_PRIVATE_KEY: 'suiprivkey1qz...' });
    expect(cfg.network).toBe('testnet');
  });

  it('accepts mainnet', () => {
    const cfg = loadConfig({ SUI_PRIVATE_KEY: 'suiprivkey1qz...', SUI_NETWORK: 'mainnet' });
    expect(cfg.network).toBe('mainnet');
  });

  it('parses SEAL_SERVERS as comma-separated', () => {
    const cfg = loadConfig({
      SUI_PRIVATE_KEY: 'suiprivkey1qz...',
      SEAL_SERVERS: '0xabc,0xdef',
    });
    expect(cfg.sealServers).toEqual(['0xabc', '0xdef']);
  });
});
