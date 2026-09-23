#!/usr/bin/env node
/**
 * walrus-agent-stack init — first-run setup. Thin wrapper over src/init.ts
 * (the bundled server runs the same code as `node plugin/server/index.mjs init`).
 */
import { initReport } from '../dist/init.js';

try {
  console.log(initReport().join('\n'));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
