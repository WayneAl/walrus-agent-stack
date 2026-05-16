#!/usr/bin/env node
import { startServer } from './mcp/server.js';
import { Dispatcher } from './mcp/dispatch.js';
import { loadConfig } from './config.js';

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
  // tools will be registered in subsequent tasks
  await startServer(dispatcher);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
