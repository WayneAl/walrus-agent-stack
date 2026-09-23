#!/usr/bin/env node
// Bundle the MCP server (src/cli.ts + all npm deps) into one ESM file the
// Claude Code plugin runs with plain `node` — no npm install or publish needed.
// Output: plugin/server/index.mjs (committed).
//
// Not minified: the file is committed and shipped to users, so it stays
// readable for review and stack traces; size matters little for a local file.
import { build } from 'esbuild';
import { statSync } from 'node:fs';

const outfile = 'plugin/server/index.mjs';

await build({
  entryPoints: ['src/cli.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  // CJS deps bundled into ESM call require()/__dirname; give them real ones.
  banner: {
    js: [
      "import { createRequire as __wasCreateRequire } from 'node:module';",
      "import { fileURLToPath as __wasFileURLToPath } from 'node:url';",
      "import { dirname as __wasDirname } from 'node:path';",
      'const require = __wasCreateRequire(import.meta.url);',
      'const __filename = __wasFileURLToPath(import.meta.url);',
      'const __dirname = __wasDirname(__filename);',
    ].join('\n'),
  },
  logLevel: 'warning',
});

console.log(`${outfile}: ${(statSync(outfile).size / 1024).toFixed(0)} KiB`);
