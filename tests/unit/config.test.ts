import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  bootstrapConfig,
  loadConfig,
  parseEnvFile,
  KNOWN_SEAL_SERVERS_TESTNET,
} from '../../src/config.js';

// Every case points WAS_HOME at a fresh tmp dir — never the real ~/.
describe('loadConfig', () => {
  let home: string;
  const key = Ed25519Keypair.generate().getSecretKey();
  beforeEach(() => {
    home = join(mkdtempSync(join(tmpdir(), 'wa-cfg-')), 'was');
  });

  it('bootstraps a key into config.env (0600, dir 0700) when none is set', () => {
    const { config, configFile, created } = bootstrapConfig({ WAS_HOME: home });
    expect(created).toBe(true);
    expect(configFile).toBe(join(home, 'config.env'));
    expect(statSync(configFile).mode & 0o777).toBe(0o600);
    expect(statSync(home).mode & 0o777).toBe(0o700);
    const file = parseEnvFile(readFileSync(configFile, 'utf-8'));
    expect(file.SUI_PRIVATE_KEY).toMatch(/^suiprivkey1/);
    expect(file.SUI_NETWORK).toBe('testnet');
    expect(file.SEAL_SERVERS).toBe(
      `${KNOWN_SEAL_SERVERS_TESTNET['mysten-testnet-1']},${KNOWN_SEAL_SERVERS_TESTNET['mysten-testnet-2']}`,
    );
    expect(config.privateKey).toBe(file.SUI_PRIVATE_KEY);
    expect(config.sealServers).toHaveLength(2);
    expect(config.relayerUrl).toBeUndefined();
    expect(config.home).toBe(home);
    expect(config.logDir).toBe(join(home, 'log'));
    expect(config.walrusStorageEpochs).toBe(30);

    // Second start reuses the stored key.
    const again = bootstrapConfig({ WAS_HOME: home });
    expect(again.created).toBe(false);
    expect(again.config.privateKey).toBe(config.privateKey);
  });

  it('defaults Seal servers on testnet when a user-supplied config omits them', () => {
    const cfg = loadConfig({ WAS_HOME: home, SUI_PRIVATE_KEY: key });
    expect(cfg.sealServers).toEqual([
      KNOWN_SEAL_SERVERS_TESTNET['mysten-testnet-1'],
      KNOWN_SEAL_SERVERS_TESTNET['mysten-testnet-2'],
    ]);
  });

  it('process env wins over config.env', () => {
    bootstrapConfig({ WAS_HOME: home });
    const cfg = loadConfig({
      WAS_HOME: home,
      SUI_PRIVATE_KEY: key,
      SEAL_SERVERS: '0xabc,0xdef',
      RELAYER_URL: 'http://localhost:3000',
    });
    expect(cfg.privateKey).toBe(key);
    expect(cfg.sealServers).toEqual(['0xabc', '0xdef']);
    expect(cfg.relayerUrl).toBe('http://localhost:3000');
  });

  it('does not generate a key when env provides one', () => {
    const { created } = bootstrapConfig({ WAS_HOME: home, SUI_PRIVATE_KEY: key });
    expect(created).toBe(false);
  });

  it('reads config.env values (comments + quotes ok)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wa-cfg2-'));
    writeFileSync(join(dir, 'config.env'), `# comment\nSUI_PRIVATE_KEY="${key}"\nWALRUS_STORAGE_EPOCHS=7\n`);
    const cfg = loadConfig({ WAS_HOME: dir });
    expect(cfg.privateKey).toBe(key);
    expect(cfg.walrusStorageEpochs).toBe(7);
  });

  it('defaults network to testnet', () => {
    expect(loadConfig({ WAS_HOME: home, SUI_PRIVATE_KEY: key }).network).toBe('testnet');
  });

  it('accepts mainnet with a relayer', () => {
    const cfg = loadConfig({
      WAS_HOME: home,
      SUI_PRIVATE_KEY: key,
      SUI_NETWORK: 'mainnet',
      RELAYER_URL: 'https://relayer.example.com',
    });
    expect(cfg.network).toBe('mainnet');
  });

  it('rejects mainnet without a relayer (no serverless package on mainnet)', () => {
    expect(() =>
      loadConfig({ WAS_HOME: home, SUI_PRIVATE_KEY: key, SUI_NETWORK: 'mainnet' }),
    ).toThrowError(/RELAYER_URL/);
  });
});
