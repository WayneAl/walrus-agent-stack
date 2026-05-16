#!/usr/bin/env tsx
/**
 * sui-stack-messaging SDK integration spike (gRPC).
 *
 * Goals:
 *  1. Prove the real `createSuiStackMessagingClient` factory wires up against testnet via gRPC.
 *  2. Gas-free probes first: getReferenceGasPrice (RPC reachability) + generateGroupDEK
 *     (Seal threshold encryption — proves Seal works without any on-chain write).
 *  3. Optional: createAndShareGroup as a relayer/gas-dependent probe; degrade gracefully if
 *     either is unavailable.
 *
 * Run:
 *   pnpm tsx scripts/spike-sdk.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SuiGrpcClient } from '@mysten/sui/grpc';
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
// Sui fullnodes serve both JSON-RPC and gRPC-Web on the same endpoint. Source:
// /Users/waynekuo/Documents/GitHub/sui-stack-messaging/docs/sui-stack-messaging/Setup.md
const SUI_GRPC_TESTNET_DEFAULT = 'https://fullnode.testnet.sui.io:443';

interface SpikeConfig {
  privateKey: string;
  relayerUrl: string;
  sealServers: string[];
  walrusPublisher: string;
  walrusAggregator: string;
  grpcBaseUrl: string;
}

function buildConfig(): SpikeConfig {
  // `.env.testnet` overrides `.env` so users who maintain both files get the testnet variant
  // for spike runs. Either is fine.
  const cwd = process.cwd();
  const envBase = loadEnvFile(resolve(cwd, '.env'));
  const envTestnet = loadEnvFile(resolve(cwd, '.env.testnet'));
  const env: Record<string, string | undefined> = { ...envBase, ...envTestnet, ...process.env };

  if (!env.SUI_PRIVATE_KEY) {
    throw new Error(
      'SUI_PRIVATE_KEY not set. Put it in .env or .env.testnet (see .env.testnet.example), or export it.\n' +
        'Generate a fresh keypair with: pnpm tsx scripts/gen-testnet-wallet.ts',
    );
  }

  const sealServers = (env.SEAL_SERVERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    privateKey: env.SUI_PRIVATE_KEY,
    relayerUrl: env.RELAYER_URL ?? 'http://localhost:3000',
    sealServers: sealServers.length ? sealServers : SEAL_TESTNET_DEFAULTS,
    walrusPublisher: env.WALRUS_PUBLISHER_URL ?? WALRUS_PUBLISHER_DEFAULT,
    walrusAggregator: env.WALRUS_AGGREGATOR_URL ?? WALRUS_AGGREGATOR_DEFAULT,
    grpcBaseUrl: env.SUI_GRPC_BASE_URL ?? SUI_GRPC_TESTNET_DEFAULT,
  };
}

// ---------- error classification ----------
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

function isInsufficientGas(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('insufficientgas') ||
    msg.includes('insufficient sui balance') ||
    msg.includes('gas selection') ||
    msg.includes('no gas coin') ||
    msg.includes('no valid gas coins') ||
    msg.includes('balance is zero') ||
    msg.includes('gas budget')
  );
}

// ---------- main ----------
async function main(): Promise<void> {
  console.log('--- sui-stack-messaging SDK spike (gRPC) ---');
  const cfg = buildConfig();
  const address = deriveAddress(cfg.privateKey);
  const keypair = loadKeypair(cfg.privateKey);

  console.log(`Sui address           : ${address}`);
  console.log(`gRPC baseUrl          : ${cfg.grpcBaseUrl}`);
  console.log(`Relayer URL           : ${cfg.relayerUrl}`);
  console.log(`Seal servers (count)  : ${cfg.sealServers.length}`);
  console.log(`Walrus publisher      : ${cfg.walrusPublisher}`);
  console.log(`Walrus aggregator     : ${cfg.walrusAggregator}`);
  console.log(
    `Testnet pkg (orig/lat): ${TESTNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG.originalPackageId} / ` +
      `${TESTNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG.latestPackageId}`,
  );

  // --- gRPC client construction ---
  const suiClient = new SuiGrpcClient({ network: 'testnet', baseUrl: cfg.grpcBaseUrl });

  // --- gas-free RPC probe: getReferenceGasPrice ---
  try {
    const gasPrice = await suiClient.getReferenceGasPrice();
    console.log(`Reference gas price   : ${gasPrice.referenceGasPrice} mist`);
  } catch (err) {
    console.error('gRPC probe FAILED — check connectivity / gRPC endpoint.');
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

  // --- gas-free Seal probe: generateGroupDEK ---
  // This exercises the full Seal threshold encryption path (talks to Seal key servers via
  // network) but does NOT write anything on-chain, so no gas is required. If this works,
  // we know the Seal serverConfigs + session key + crypto path is wired correctly even
  // when the wallet is unfunded.
  console.log('\n--- gas-free Seal probe: generateGroupDEK ---');
  try {
    const { uuid, encryptedDek } = await messagingClient.messaging.encryption.generateGroupDEK();
    console.log(`Seal-encrypted DEK OK — uuid=${uuid} encryptedDek=${encryptedDek.byteLength} bytes`);
  } catch (err) {
    console.error('generateGroupDEK FAILED — Seal path is broken.');
    console.error(err);
    process.exit(1);
  }

  // --- relayer/gas-dependent probe: createAndShareGroup ---
  console.log('\n--- relayer+gas probe: createAndShareGroup ---');
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
      process.exit(0);
    }
    if (isInsufficientGas(err)) {
      console.log(
        'WALLET NOT FUNDED — request testnet SUI via: pnpm tsx scripts/gen-testnet-wallet.ts ' +
          "(or call the faucet for the existing address). SDK plumbing is correct; we just can't pay gas.",
      );
      console.log(`(underlying error: ${(err as Error).message})`);
      process.exit(0);
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
