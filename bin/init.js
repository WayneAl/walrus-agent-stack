#!/usr/bin/env node
/**
 * walrus-agent-stack init — first-run setup.
 *
 * Runs the same bootstrap the MCP server runs on start (dist/config.js): with
 * no SUI_PRIVATE_KEY in env or ~/.walrus-agent-stack/config.env ($WAS_HOME
 * overrides the dir) it generates a testnet key and writes config.env (0600).
 * Idempotent: an existing config is loaded, never overwritten.
 */
import { bootstrapConfig } from '../dist/config.js';
import { deriveAddress } from '../dist/wallet.js';
import { webFaucetUrl } from '../dist/errors.js';

try {
  const { config, configFile, created } = bootstrapConfig();
  const address = deriveAddress(config.privateKey);
  console.log(created ? `Generated wallet, config written to ${configFile}` : `Using config ${configFile}`);
  console.log(`Address: ${address}`);
  console.log(`Network: ${config.network}`);
  console.log(`Transport: ${config.relayerUrl ? `relayer ${config.relayerUrl}` : 'serverless (Sui + Walrus)'}`);
  console.log('\nNext steps:');
  if (config.network === 'testnet') {
    console.log(`  1. Fund the wallet: run the system_setup tool (uses the faucet) or open ${webFaucetUrl(address)}`);
  } else {
    console.log(`  1. Send SUI to ${address} for gas.`);
  }
  console.log('  2. Share your address with collaborators so they can invite you.');
  console.log('  3. In Claude Code: /agent-stack setup, then /agent-channel new "<topic>" <peer-address>.');
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
