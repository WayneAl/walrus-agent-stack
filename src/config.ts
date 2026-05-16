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

const DEFAULT_RELAYER_TESTNET = 'https://relayer.testnet.example.com';
const DEFAULT_RELAYER_MAINNET = 'https://relayer.mainnet.example.com';
const DEFAULT_RPC_TESTNET = 'https://fullnode.testnet.sui.io:443';
const DEFAULT_RPC_MAINNET = 'https://fullnode.mainnet.sui.io:443';

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
