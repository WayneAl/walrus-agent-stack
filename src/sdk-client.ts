import { SuiGrpcClient } from '@mysten/sui/grpc';
import { createSuiStackMessagingClient } from '@mysten/sui-stack-messaging';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Config } from './config.js';
import { loadKeypair } from './wallet.js';

export interface SdkContext {
  client: ReturnType<typeof createSuiStackMessagingClient>;
  keypair: Ed25519Keypair;
  config: Config;
}

let cached: SdkContext | null = null;

export function getSdk(config: Config): SdkContext {
  if (cached) return cached;
  if (config.rpcUrls.length === 0) {
    throw new Error('config.rpcUrls is empty');
  }
  const keypair = loadKeypair(config.privateKey);
  const grpc = new SuiGrpcClient({
    network: config.network,
    baseUrl: config.rpcUrls[0]!,
  });
  const client = createSuiStackMessagingClient(grpc, {
    seal: {
      serverConfigs: config.sealServers.map((id) => ({ objectId: id, weight: 1 })),
    },
    encryption: {
      sessionKey: { signer: keypair },
    },
    relayer: { relayerUrl: config.relayerUrl },
  });
  cached = { client, keypair, config };
  return cached;
}
