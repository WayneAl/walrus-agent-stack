import { SuiGrpcClient } from '@mysten/sui/grpc';
import {
  createSuiStackMessagingClient,
  WalrusHttpStorageAdapter,
} from '@mysten/sui-stack-messaging';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { CHANNEL_LOG_TESTNET, type Config } from './config.js';
import { loadKeypair } from './wallet.js';
import { SuiWalrusTransport } from './transport/sui-walrus-transport.js';

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
    // RELAYER_URL set → HTTP relayer; otherwise the serverless Sui + Walrus
    // transport (loadConfig rejects mainnet without a relayer).
    relayer: config.relayerUrl
      ? { relayerUrl: config.relayerUrl }
      : {
          transport: new SuiWalrusTransport({
            grpc,
            packageId: CHANNEL_LOG_TESTNET.packageId,
            registryId: CHANNEL_LOG_TESTNET.registryId,
            walrus: {
              publisherUrl: config.walrusPublisherUrl,
              aggregatorUrl: config.walrusAggregatorUrl,
              epochs: config.walrusStorageEpochs,
            },
          }),
        },
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

/** Drop the cached context so the next `getSdk` rebuilds from a fresh config. */
export function resetSdk(): void {
  cached = null;
}
