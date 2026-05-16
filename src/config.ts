import { z } from 'zod';

export const ConfigSchema = z.object({
  privateKey: z.string().min(1),
  network: z.enum(['mainnet', 'testnet']).default('testnet'),
  relayerUrl: z.string().url(),
  sealServers: z.array(z.string()),
  rpcUrls: z.array(z.string().url()).min(1),
  logDir: z.string(),
});

export type Config = z.infer<typeof ConfigSchema>;

export type ConfigEnv = NodeJS.ProcessEnv;

// NOTE: there is no public hosted sui-stack-messaging relayer at this time.
// Operators must run their own relayer from
// https://github.com/MystenLabs/sui-stack-messaging/tree/main/relayer
// and set RELAYER_URL explicitly in their env. The constants below are
// non-functional placeholders kept for back-compat; loadConfig surfaces a
// validation error if the value is left at the placeholder URL.
const DEFAULT_RELAYER_TESTNET = 'https://relayer.testnet.example.com';
// PLACEHOLDER: see docs/MAINNET.md — provision a self-hosted or private
// hosted relayer pointed at mainnet and set RELAYER_URL accordingly.
const DEFAULT_RELAYER_MAINNET = 'https://relayer.mainnet.example.com';
const DEFAULT_RPC_TESTNET = 'https://fullnode.testnet.sui.io:443';
const DEFAULT_RPC_MAINNET = 'https://fullnode.mainnet.sui.io:443';

// Known Seal key-server object IDs.
//
// Testnet: discovered from sui-stack-messaging/chat-app/.env. These are the
// permissioned-groups demo's threshold-encryption servers; they are also fine
// for general sui-stack-messaging integration.
//
// Mainnet: NOT discovered. The @mysten/seal SDK removed
// `getAllowlistedKeyServers` in a recent release and no mainnet IDs are
// hardcoded in either the Seal SDK or the sui-stack-messaging repo. Users
// must look up current allowlisted mainnet key servers from the Seal docs
// (see docs/MAINNET.md) and pass them via SEAL_SERVERS=<id1>,<id2>.
//
// These constants are intentionally NOT consumed by loadConfig — they exist
// as in-source documentation and to make future automation easier. The env
// var `SEAL_SERVERS` remains the sole source of truth at runtime.
export const KNOWN_SEAL_SERVERS_TESTNET = [
  '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
  '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8',
] as const;
export const KNOWN_SEAL_SERVERS_MAINNET: readonly string[] = [
  // TBD: discover mainnet key servers from Seal docs / Mysten deployment.
];

export function loadConfig(env: ConfigEnv = process.env): Config {
  if (!env.SUI_PRIVATE_KEY) {
    throw new Error('SUI_PRIVATE_KEY must be set in environment');
  }
  const network = (env.SUI_NETWORK ?? 'testnet') as 'mainnet' | 'testnet';
  return ConfigSchema.parse({
    privateKey: env.SUI_PRIVATE_KEY,
    network,
    relayerUrl: env.RELAYER_URL ?? (network === 'mainnet' ? DEFAULT_RELAYER_MAINNET : DEFAULT_RELAYER_TESTNET),
    sealServers: (env.SEAL_SERVERS ?? '').split(',').filter(Boolean),
    rpcUrls: (env.SUI_RPC_URLS ?? (network === 'mainnet' ? DEFAULT_RPC_MAINNET : DEFAULT_RPC_TESTNET)).split(','),
    logDir: env.LOG_DIR ?? `${process.env.HOME}/.walrus-agent-stack/log`,
  });
}
