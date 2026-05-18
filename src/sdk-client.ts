import { SuiGrpcClient } from '@mysten/sui/grpc';
import {
  createSuiStackMessagingClient,
  WalrusHttpStorageAdapter,
} from '@mysten/sui-stack-messaging';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Config } from './config.js';
import { loadKeypair } from './wallet.js';

// Lock TApproveContext to void via instantiation expression. Without this,
// `ReturnType<typeof createSuiStackMessagingClient>` infers TApproveContext as
// `unknown`, which forces every messaging call site to deal with a required
// `sealApproveContext: unknown` field. We don't configure a custom SealPolicy,
// so the default `void` branch is the correct shape for the whole codebase.
export type SuiStackMessagingClient = ReturnType<typeof createSuiStackMessagingClient<void>>;

export interface SdkContext {
  client: SuiStackMessagingClient;
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
    attachments: {
      storageAdapter: new WalrusHttpStorageAdapter({
        publisherUrl: config.walrusPublisherUrl,
        aggregatorUrl: config.walrusAggregatorUrl,
        epochs: config.walrusStorageEpochs,
      }),
    },
  });
  cached = { client, keypair, config };
  return cached;
}
