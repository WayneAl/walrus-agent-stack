#!/usr/bin/env tsx
/**
 * Generate a fresh Ed25519 testnet keypair and (optionally) request faucet funds.
 *
 * Outputs to stdout — the user copies values into `.env.testnet`.
 * The script intentionally never writes to disk so secrets stay under user control.
 *
 * Usage:
 *   pnpm tsx scripts/gen-testnet-wallet.ts            # generate + faucet
 *   pnpm tsx scripts/gen-testnet-wallet.ts --no-faucet
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const FAUCET_V2 = 'https://faucet.testnet.sui.io/v2/gas';
const FAUCET_V1 = 'https://faucet.testnet.sui.io/gas';

async function requestFaucet(recipient: string): Promise<void> {
  const body = JSON.stringify({ FixedAmountRequest: { recipient } });
  const endpoints = [FAUCET_V2, FAUCET_V1];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (res.ok) {
        console.log(`Faucet OK via ${url} (status ${res.status})`);
        return;
      }
      if (res.status === 404) {
        console.log(`Faucet ${url} returned 404; trying next endpoint`);
        continue;
      }
      const text = await res.text().catch(() => '<no body>');
      console.log(`Faucet ${url} returned ${res.status}: ${text}`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`Faucet ${url} threw: ${msg}; trying next endpoint`);
    }
  }
  console.log('Faucet request failed on all known endpoints (testnet may be rate-limiting).');
}

async function main(): Promise<void> {
  const skipFaucet = process.argv.includes('--no-faucet');
  const kp = Ed25519Keypair.generate();
  const address = kp.toSuiAddress();
  const privateKey = kp.getSecretKey(); // Bech32 "suiprivkey1..."

  console.log('# === Fresh testnet keypair ===');
  console.log(`# Generated at ${new Date().toISOString()}`);
  console.log(`# Address: ${address}`);
  console.log('# Copy the following line into .env.testnet (this file is gitignored):');
  console.log();
  console.log(`SUI_PRIVATE_KEY=${privateKey}`);
  console.log();

  if (!skipFaucet) {
    console.log('Requesting faucet funds...');
    await requestFaucet(address);
  } else {
    console.log('Skipping faucet (--no-faucet).');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
