import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Dispatcher } from '../../../src/mcp/dispatch.js';
import { loadConfig } from '../../../src/config.js';
import { getSdk } from '../../../src/sdk-client.js';
import { ToolLog } from '../../../src/logging.js';
import { Outbox } from '../../../src/outbox.js';
import { whoamiTool, verifyTool } from '../../../src/tools/identity.js';
import {
  createTool,
  membersTool,
  inviteTool,
  kickTool,
  leaveTool,
} from '../../../src/tools/channel-lifecycle.js';
import { sendTool, historyTool } from '../../../src/tools/channel-messaging.js';
import { joinTool } from '../../../src/tools/channel-subscribe.js';
import {
  writeTool as memoryWriteTool,
  readTool as memoryReadTool,
} from '../../../src/tools/memory.js';
import { debugTool, resendTool, healthTool } from '../../../src/tools/system.js';

export interface TestEnv {
  dispatcher: Dispatcher;
  address: string;
  config: ReturnType<typeof loadConfig>;
}

/**
 * Returns true only when both required integration env vars are non-empty.
 * Integration test suites should gate with `describe.skipIf(!hasIntegrationEnv())`
 * so `pnpm test` (without env) silently skips them instead of failing.
 */
export function hasIntegrationEnv(): boolean {
  return Boolean(process.env.TEST_RELAYER_URL && process.env.TEST_SEAL_SERVERS);
}

/**
 * Build a fully-wired test environment with a fresh Ed25519 wallet, all 15
 * MCP tools registered, and isolated log+outbox dirs under tmpdir.
 *
 * Caller is responsible for funding the returned address (see faucet helper)
 * before invoking any on-chain tool.
 */
export function newWalletEnv(): TestEnv {
  const kp = new Ed25519Keypair();
  process.env.SUI_PRIVATE_KEY = kp.getSecretKey(); // Bech32 "suiprivkey1..."
  process.env.SUI_NETWORK = 'testnet';
  process.env.RELAYER_URL = process.env.TEST_RELAYER_URL!;
  process.env.SEAL_SERVERS = process.env.TEST_SEAL_SERVERS!;
  process.env.LOG_DIR = mkdtempSync(join(tmpdir(), 'wa-test-'));

  const config = loadConfig();
  const sdk = getSdk(config);
  const log = new ToolLog(config.logDir);
  // Outbox lives in a sibling subdir under the test log dir so JSONL log
  // scrapes don't accidentally pick up retry queue files.
  const outbox = new Outbox(join(config.logDir, 'outbox'));
  const dispatcher = new Dispatcher(log);

  // Registration order matches src/cli.ts for parity.
  dispatcher.register(whoamiTool(sdk));
  dispatcher.register(verifyTool(sdk));
  dispatcher.register(createTool(sdk));
  dispatcher.register(membersTool(sdk));
  dispatcher.register(inviteTool(sdk));
  dispatcher.register(kickTool(sdk));
  dispatcher.register(leaveTool(sdk));
  dispatcher.register(sendTool(sdk, outbox));
  dispatcher.register(historyTool(sdk));
  dispatcher.register(joinTool(sdk));
  dispatcher.register(memoryWriteTool(sdk));
  dispatcher.register(memoryReadTool(sdk));
  dispatcher.register(debugTool(log));
  dispatcher.register(resendTool(outbox, dispatcher));
  dispatcher.register(healthTool(sdk));

  return { dispatcher, address: kp.toSuiAddress(), config };
}
