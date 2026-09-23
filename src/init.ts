import { bootstrapConfig, type ConfigEnv } from './config.js';
import { deriveAddress } from './wallet.js';
import { webFaucetUrl } from './errors.js';

/**
 * First-run setup report (`walrus-agent-stack init` / `index.mjs init`).
 *
 * Runs the same bootstrap the MCP server runs on start: with no
 * SUI_PRIVATE_KEY in env or $WAS_HOME/config.env it generates a testnet key
 * and writes config.env (0600). Idempotent: an existing config is loaded,
 * never overwritten. Returns the lines to print.
 */
export function initReport(env: ConfigEnv = process.env): string[] {
  const { config, configFile, created } = bootstrapConfig(env);
  const address = deriveAddress(config.privateKey);
  const lines = [
    created ? `Generated wallet, config written to ${configFile}` : `Using config ${configFile}`,
    `Address: ${address}`,
    `Network: ${config.network}`,
    `Transport: ${config.relayerUrl ? `relayer ${config.relayerUrl}` : 'serverless (Sui + Walrus)'}`,
    '',
    'Next steps:',
  ];
  if (config.network === 'testnet') {
    lines.push(`  1. Fund the wallet: run /agent-stack setup (uses the faucet) or open ${webFaucetUrl(address)}`);
  } else {
    lines.push(`  1. Send SUI to ${address} for gas.`);
  }
  lines.push(
    '  2. Share your address with collaborators so they can invite you.',
    '  3. In Claude Code: /agent-channel new "<topic>" <peer-address>, or /agent-channel join <channel_id>.',
  );
  return lines;
}
