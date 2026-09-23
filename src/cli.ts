#!/usr/bin/env node
import path from 'node:path';
import { startServer } from './mcp/server.js';
import { Dispatcher } from './mcp/dispatch.js';
import { loadConfig } from './config.js';
import { getSdk } from './sdk-client.js';
import { whoamiTool, verifyTool } from './tools/identity.js';
import {
  createTool,
  membersTool,
  inviteTool,
  kickTool,
  leaveTool,
} from './tools/channel-lifecycle.js';
import { sendTool, historyTool } from './tools/channel-messaging.js';
import { joinTool, waitTool } from './tools/channel-subscribe.js';
import { writeTool as memoryWriteTool, readTool as memoryReadTool } from './tools/memory.js';
import { debugTool, resendTool, healthTool, setupTool } from './tools/system.js';
import { ToolLog } from './logging.js';
import { Outbox } from './outbox.js';
import { mapSdkError } from './errors.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--health')) {
    // Health check, no MCP needed
    try {
      loadConfig();
      console.log(JSON.stringify({ status: 'ok' }));
      process.exit(0);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(JSON.stringify({ status: 'error', message }));
      process.exit(1);
    }
  }

  const config = loadConfig();
  const toolLog = new ToolLog(config.logDir);
  // Outbox lives next to (not inside) the log dir so JSONL log scrapes don't
  // accidentally pick it up. `dirname(logDir)/outbox` cleanly sits alongside
  // the per-day log files.
  const outbox = new Outbox(path.join(path.dirname(config.logDir), 'outbox'));
  const sdk = getSdk(config);
  const address = sdk.keypair.toSuiAddress();
  const dispatcher = new Dispatcher(toolLog, (e) =>
    mapSdkError(e, { address, network: config.network }),
  );
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
  dispatcher.register(waitTool(sdk));
  dispatcher.register(memoryWriteTool(sdk));
  dispatcher.register(memoryReadTool(sdk));
  dispatcher.register(debugTool(toolLog));
  dispatcher.register(resendTool(outbox, dispatcher));
  dispatcher.register(healthTool(sdk));
  dispatcher.register(setupTool(sdk));
  await startServer(dispatcher);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
