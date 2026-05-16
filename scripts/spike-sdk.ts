#!/usr/bin/env tsx
/**
 * sui-stack-messaging SDK integration spike.
 *
 * Goals:
 *  1. Prove the real `createSuiStackMessagingClient` factory wires up against testnet.
 *  2. Exercise a read-only RPC path (no relayer needed) to confirm RPC + auto package config.
 *  3. Attempt a relayer-dependent op and degrade gracefully if no relayer is running.
 *
 * The spike does NOT consume `src/config.ts` directly because Task 2's Config requires
 * a valid `relayerUrl` and we want the spike to run even when none is set. This is the
 * cleanest place to inline testnet defaults for now — see docs/sdk-notes.md for the
 * follow-up plan.
 *
 * Run:
 *   pnpm tsx scripts/spike-sdk.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getJsonRpcFullnodeUrl, SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import {
  createSuiStackMessagingClient,
  TESTNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG,
  WalrusHttpStorageAdapter,
} from '@mysten/sui-stack-messaging';

import { loadKeypair, deriveAddress } from '../src/wallet.js';

// ---------- tiny .env parser (no dotenv dep) ----------
function loadEnvFile(path: string): Record<string, string> {
  try {
    const raw = readFileSync(path, 'utf8');
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

// ---------- spike config (testnet defaults baked in) ----------
const SEAL_TESTNET_DEFAULTS = [
  '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
  '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8',
];

const WALRUS_PUBLISHER_DEFAULT = 'https://publisher.walrus-testnet.walrus.space';
const WALRUS_AGGREGATOR_DEFAULT = 'https://aggregator.walrus-testnet.walrus.space';

interface SpikeConfig {
  privateKey: string;
  rpcUrl: string;
  relayerUrl: string;
  sealServers: string[];
  walrusPublisher: string;
  walrusAggregator: string;
}

function buildConfig(): SpikeConfig {
  const fileEnv = loadEnvFile(resolve(process.cwd(), '.env.testnet'));
  const env: Record<string, string | undefined> = { ...fileEnv, ...process.env };

  if (!env.SUI_PRIVATE_KEY) {
    throw new Error(
      'SUI_PRIVATE_KEY not set. Create .env.testnet (see .env.testnet.example) or export it.\n' +
        'Generate a fresh keypair with: pnpm tsx scripts/gen-testnet-wallet.ts',
    );
  }

  const sealServers = (env.SEAL_SERVERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    privateKey: env.SUI_PRIVATE_KEY,
    rpcUrl: (env.SUI_RPC_URLS ?? getJsonRpcFullnodeUrl('testnet')).split(',')[0]!.trim(),
    relayerUrl: env.RELAYER_URL ?? 'http://localhost:3000',
    sealServers: sealServers.length ? sealServers : SEAL_TESTNET_DEFAULTS,
    walrusPublisher: env.WALRUS_PUBLISHER_URL ?? WALRUS_PUBLISHER_DEFAULT,
    walrusAggregator: env.WALRUS_AGGREGATOR_URL ?? WALRUS_AGGREGATOR_DEFAULT,
  };
}

// ---------- relayer error detection ----------
function isRelayerUnreachable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const stack = `${err.message}\n${err.stack ?? ''}`.toLowerCase();
  return (
    stack.includes('econnrefused') ||
    stack.includes('fetch failed') ||
    stack.includes('enotfound') ||
    stack.includes('etimedout') ||
    stack.includes('network is unreachable') ||
    stack.includes('socket hang up')
  );
}

// ---------- main ----------
async function main(): Promise<void> {
  console.log('--- sui-stack-messaging SDK spike ---');
  const cfg = buildConfig();
  const address = deriveAddress(cfg.privateKey);
  const keypair = loadKeypair(cfg.privateKey);

  console.log(`Sui address           : ${address}`);
  console.log(`RPC URL               : ${cfg.rpcUrl}`);
  console.log(`Relayer URL           : ${cfg.relayerUrl}`);
  console.log(`Seal servers (count)  : ${cfg.sealServers.length}`);
  console.log(`Walrus publisher      : ${cfg.walrusPublisher}`);
  console.log(`Walrus aggregator     : ${cfg.walrusAggregator}`);
  console.log(
    `Testnet pkg (orig/lat): ${TESTNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG.originalPackageId} / ` +
      `${TESTNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG.latestPackageId}`,
  );
  console.log(
    `Testnet namespace     : ${TESTNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG.namespaceId}`,
  );

  // --- read-only RPC probe (no relayer needed) ---
  const suiClient = new SuiJsonRpcClient({ url: cfg.rpcUrl, network: 'testnet' });
  try {
    const version = await suiClient.getRpcApiVersion();
    console.log(`Sui RPC API version   : ${version ?? '<unknown>'}`);
  } catch (err) {
    console.error('Sui RPC probe FAILED — check connectivity / RPC URL.');
    console.error(err);
    process.exit(1);
  }

  // --- build messaging client with real factory ---
  const messagingClient = createSuiStackMessagingClient(suiClient, {
    seal: {
      serverConfigs: cfg.sealServers.map((objectId) => ({ objectId, weight: 1 })),
    },
    encryption: {
      sessionKey: { signer: keypair, ttlMin: 10 },
    },
    relayer: { relayerUrl: cfg.relayerUrl },
    attachments: {
      storageAdapter: new WalrusHttpStorageAdapter({
        publisherUrl: cfg.walrusPublisher,
        aggregatorUrl: cfg.walrusAggregator,
        epochs: 1,
      }),
      maxAttachments: 5,
      maxFileSizeBytes: 5 * 1024 * 1024,
    },
  });

  console.log('Client extensions     : core, groups, seal, messaging');
  console.log(`messaging client OK   : ${messagingClient.messaging.constructor.name}`);
  console.log(`groups client OK      : ${messagingClient.groups.constructor.name}`);
  console.log(`seal client OK        : ${messagingClient.seal.constructor.name}`);

  // --- relayer-dependent probe: createAndShareGroup ---
  console.log('\n--- relayer-dependent probe: createAndShareGroup ---');
  try {
    const result = await messagingClient.messaging.createAndShareGroup({
      signer: keypair,
      name: `spike-${new Date().toISOString()}`,
    });
    console.log(`createAndShareGroup OK — digest=${result.digest}`);
  } catch (err) {
    if (isRelayerUnreachable(err)) {
      console.log(
        'RELAYER UNREACHABLE — set RELAYER_URL to a running sui-stack-messaging relayer.',
      );
      console.log(
        'Reference relayer: /Users/waynekuo/Documents/GitHub/sui-stack-messaging/relayer/README.md',
      );
      console.log(`(underlying error: ${(err as Error).message})`);
      // Note: createAndShareGroup is mostly on-chain; a relayer is required for sendMessage.
      // Still, this branch handles any HTTP transport setup error so the spike never
      // surfaces a stack trace for the expected "no relayer" case.
      process.exit(0);
    }
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      // Insufficient gas / no coins is also expected on a fresh, unfunded wallet.
      if (
        msg.includes('insufficientgas') ||
        msg.includes('no gas coin') ||
        msg.includes('no valid gas coins') ||
        msg.includes('balance is zero') ||
        msg.includes('gas budget')
      ) {
        console.log(
          'WALLET NOT FUNDED — request testnet SUI via: pnpm tsx scripts/gen-testnet-wallet.ts ' +
            "(or call the faucet for the existing address). The SDK plumbing is correct; we just can't pay gas.",
        );
        console.log(`(underlying error: ${err.message})`);
        process.exit(0);
      }
    }
    console.error('createAndShareGroup FAILED with unexpected error:');
    console.error(err);
    process.exit(1);
  }

  console.log('\nSpike OK — full round-trip succeeded.');
}

main().catch((err) => {
  console.error('Unexpected spike failure:');
  console.error(err);
  process.exit(1);
});
