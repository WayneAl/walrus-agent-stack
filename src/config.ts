import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { z } from 'zod';

export const ConfigSchema = z.object({
  privateKey: z.string().min(1),
  network: z.enum(['mainnet', 'testnet']).default('testnet'),
  // Absent → serverless transport (Sui `channel_log` + Walrus); set → HTTP relayer.
  relayerUrl: z.string().url().optional(),
  sealServers: z.array(z.string()),
  rpcUrls: z.array(z.string().url()).min(1),
  // $WAS_HOME: holds config.env, session.json, log/ and outbox/.
  home: z.string(),
  logDir: z.string(),
  walrusPublisherUrl: z.string().url(),
  walrusAggregatorUrl: z.string().url(),
  walrusStorageEpochs: z.number().int().positive(),
});

export type Config = z.infer<typeof ConfigSchema>;

export type ConfigEnv = NodeJS.ProcessEnv;

const DEFAULT_RPC_TESTNET = 'https://fullnode.testnet.sui.io:443';
const DEFAULT_RPC_MAINNET = 'https://fullnode.mainnet.sui.io:443';

const DEFAULT_WALRUS_PUBLISHER_TESTNET = 'https://publisher.walrus-testnet.walrus.space';
const DEFAULT_WALRUS_AGGREGATOR_TESTNET = 'https://aggregator.walrus-testnet.walrus.space';
const DEFAULT_WALRUS_PUBLISHER_MAINNET = 'https://publisher.walrus-mainnet.walrus.space';
const DEFAULT_WALRUS_AGGREGATOR_MAINNET = 'https://aggregator.walrus-mainnet.walrus.space';

// Seal Move package IDs (verified from https://seal-docs.wal.app/UsingSeal).
export const SEAL_PACKAGE_ID_TESTNET =
  '0x4016869413374eaa71df2a043d1660ed7bc927ab7962831f8b07efbc7efdb2c3';
export const SEAL_PACKAGE_ID_MAINNET =
  '0xcb83a248bda5f7a0a431e6bf9e96d184e604130ec5218696e3f1211113b447b7';

// `channel_log` Move package (move/channel_log): the serverless message index
// the SuiWalrusTransport posts to. Published on testnet 2026-09-23, digest
// 8ohK5NxBBsuqWgBZbLJ9cLiky8gaPRkUMXEdsGtbn3o9. Not yet on mainnet.
export const CHANNEL_LOG_TESTNET = {
  packageId: '0x04d4a5ff8e98fc8eb51f946b46cb07c2152d0f142e62be312e19425094e913f1',
  registryId: '0xab7abf4bdc9f1374dc2ae65b295e0e01d54912525e96e76db807ff1016066a64',
} as const;

// Known Seal key-server object IDs (source: https://seal-docs.wal.app/Pricing).
//
// All testnet servers below run in "Open mode" — no API key, source-IP rate
// limiting only. The first two (mysten-testnet-1/2) are the historical
// default and match what sui-stack-messaging/chat-app ships with. The rest
// are third-party operators verified by the Seal team. Choose 2+ of these
// (any operators) for a quorum that survives one provider going down.
//
// `SEAL_SERVERS` (comma-separated, env or config.env) is the runtime source of
// truth; first-run bootstrap writes the two Mysten servers into config.env.
export const KNOWN_SEAL_SERVERS_TESTNET = {
  'mysten-testnet-1':
    '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
  'mysten-testnet-2':
    '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8',
  'ruby-nodes':
    '0x6068c0acb197dddbacd4746a9de7f025b2ed5a5b6c1b1ab44dade4426d141da2',
  'nodeinfra':
    '0x5466b7df5c15b508678d51496ada8afab0d6f70a01c10613123382b1b8131007',
  'studio-mirai':
    '0x164ac3d2b3b8694b8181c13f671950004765c23f270321a45fdd04d40cccf0f2',
  'overclock':
    '0x9c949e53c36ab7a9c484ed9e8b43267a77d4b8d70e79aa6b39042e3d4c434105',
  'h2o-nodes':
    '0x39cef09b24b667bc6ed54f7159d82352fe2d5dd97ca9a5beaa1d21aa774f25a2',
  'triton-one':
    '0x4cded1abeb52a22b6becb42a91d3686a4c901cf52eee16234214d0b5b2da4c46',
  'natsai':
    '0x3c93ec1474454e1b47cf485a4e5361a5878d722b9492daf10ef626a76adc3dad',
} as const;

// Decentralized committee aggregator (testnet): a single object ID that fronts
// a 3-of-5 threshold committee (Mysten Labs / Natsai / Overclock / NodeInfra
// / Ruby Nodes). Aggregator: https://seal-aggregator-testnet.mystenlabs.com.
// Counts as one server in `serverConfigs`; preferred default for new apps.
export const SEAL_TESTNET_COMMITTEE_AGGREGATOR =
  '0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98';

// Mainnet:
//   • Independent key servers — exist, but EVERY provider issues permissioned
//     (per-customer) object IDs; there is NO public open-mode mainnet server.
//     Providers: Enoki (Mysten Labs), Ruby Nodes, NodeInfra, Overclock, Studio
//     Mirai, H2O Nodes, Triton One, Natsai. Sign up + receive an object ID.
//   • Decentralized mainnet committee — "Available soon" per Seal docs as of
//     2026-05-17; not yet deployed.
// So we cannot hardcode a mainnet default. See docs/MAINNET.md.
export const KNOWN_SEAL_SERVERS_MAINNET: readonly string[] = [];

export function wasHome(env: ConfigEnv = process.env): string {
  return env.WAS_HOME ?? join(homedir(), '.walrus-agent-stack');
}

/** Parse `KEY=VALUE` lines; `#` comments, blank lines and surrounding quotes allowed. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    out[key] = value;
  }
  return out;
}

export interface BootstrapResult {
  config: Config;
  configFile: string;
  /** True when this call generated a new key and wrote config.env. */
  created: boolean;
}

/**
 * Load config from `$WAS_HOME/config.env` overlaid by `env` (env wins). With
 * no `SUI_PRIVATE_KEY` anywhere, generate an Ed25519 testnet key and write it
 * to config.env (0600, dir 0700) so first start needs no manual setup.
 * `WAS_HOME` is read from `env` only — tests pass a tmp dir there.
 */
export function bootstrapConfig(env: ConfigEnv = process.env): BootstrapResult {
  const home = wasHome(env);
  const configFile = join(home, 'config.env');
  const fromFile = existsSync(configFile) ? parseEnvFile(readFileSync(configFile, 'utf-8')) : {};
  const merged: Record<string, string | undefined> = { ...fromFile };
  for (const [k, v] of Object.entries(env)) if (v !== undefined) merged[k] = v;

  let created = false;
  if (!merged.SUI_PRIVATE_KEY) {
    const generated = {
      SUI_PRIVATE_KEY: Ed25519Keypair.generate().getSecretKey(),
      SUI_NETWORK: 'testnet',
      SEAL_SERVERS: [
        KNOWN_SEAL_SERVERS_TESTNET['mysten-testnet-1'],
        KNOWN_SEAL_SERVERS_TESTNET['mysten-testnet-2'],
      ].join(','),
    };
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const lines = [
      '# walrus-agent-stack config — generated on first start. Edit to override;',
      '# process environment variables take precedence over this file.',
      ...Object.entries({ ...fromFile, ...generated }).map(([k, v]) => `${k}=${v}`),
      '',
    ];
    writeFileSync(configFile, lines.join('\n'), { mode: 0o600 });
    chmodSync(configFile, 0o600); // mode is ignored when the file already existed
    created = true;
    // Env wins over the file, except that an unset key means env had no opinion.
    for (const [k, v] of Object.entries(generated)) if (!env[k]) merged[k] = v;
  }

  const network = (merged.SUI_NETWORK ?? 'testnet') as 'mainnet' | 'testnet';
  if (network === 'mainnet' && !merged.RELAYER_URL) {
    throw new Error(
      'SUI_NETWORK=mainnet needs RELAYER_URL: the serverless channel_log package is published on testnet only',
    );
  }
  const config = ConfigSchema.parse({
    privateKey: merged.SUI_PRIVATE_KEY,
    network,
    relayerUrl: merged.RELAYER_URL || undefined,
    sealServers: (merged.SEAL_SERVERS ?? '').split(',').filter(Boolean),
    rpcUrls: (merged.SUI_RPC_URLS ?? (network === 'mainnet' ? DEFAULT_RPC_MAINNET : DEFAULT_RPC_TESTNET)).split(','),
    home,
    logDir: merged.LOG_DIR ?? join(home, 'log'),
    walrusPublisherUrl:
      merged.WALRUS_PUBLISHER_URL ??
      (network === 'mainnet' ? DEFAULT_WALRUS_PUBLISHER_MAINNET : DEFAULT_WALRUS_PUBLISHER_TESTNET),
    walrusAggregatorUrl:
      merged.WALRUS_AGGREGATOR_URL ??
      (network === 'mainnet' ? DEFAULT_WALRUS_AGGREGATOR_MAINNET : DEFAULT_WALRUS_AGGREGATOR_TESTNET),
    walrusStorageEpochs: merged.WALRUS_STORAGE_EPOCHS ? Number(merged.WALRUS_STORAGE_EPOCHS) : 30,
  });
  return { config, configFile, created };
}

export function loadConfig(env: ConfigEnv = process.env): Config {
  return bootstrapConfig(env).config;
}
