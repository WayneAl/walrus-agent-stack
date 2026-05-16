#!/usr/bin/env node
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

  const dispatcher = new Dispatcher();
  const config = loadConfig();
  const sdk = getSdk(config);
  dispatcher.register(whoamiTool(sdk));
  dispatcher.register(verifyTool(sdk));
  dispatcher.register(createTool(sdk));
  dispatcher.register(membersTool(sdk));
  dispatcher.register(inviteTool(sdk));
  dispatcher.register(kickTool(sdk));
  dispatcher.register(leaveTool(sdk));
  await startServer(dispatcher);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
