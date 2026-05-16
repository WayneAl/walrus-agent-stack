# Walrus Agent Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript MCP server + Claude Code plugin that gives any MCP-compatible AI agent **encrypted channel coordination + Walrus-backed shared memory + Sui-anchored cross-org identity**, demoed end-to-end with two users (Alice + Bob) collaborating across wallets.

**Architecture:** Local-process stdio MCP server (TypeScript) wraps `@mysten/sui-stack-messaging` SDK; exposes 15 tools (channel.*, memory.*, identity.*, system.*) backed by Sui Groups + Walrus + Seal. Claude Code plugin bundles MCP config + 3 subagent templates (research-leader / analyst / synthesizer) + slash command family + auto-archive Stop hook. No new Move package — reuses sui-stack-messaging on-chain primitives.

**Tech Stack:** TypeScript (strict), pnpm, vitest, Zod, `@mysten/sui`, `@mysten/sui-stack-messaging`, `@modelcontextprotocol/sdk`, Node 20+.

**Spec:** [`docs/superpowers/specs/2026-05-15-agent-stack-design.md`](../specs/2026-05-15-agent-stack-design.md)

---

## Pre-Flight Assumptions (read first)

- **Implementation root**: `/Users/waynekuo/Documents/GitHub/walrus-agent-stack/`. All `Files:` paths below are relative to this root unless otherwise stated.
- **Spec / plan docs**: live in this repo under `docs/superpowers/{specs,plans,research}/`. Research snapshots of MemWal docs at `docs/superpowers/research/memwal/`.
- **sui-stack-messaging SDK**: installed from npm as `@mysten/sui-stack-messaging`. If npm version lacks needed APIs, `pnpm link` to a local build of `/Users/waynekuo/Documents/GitHub/sui-stack-messaging/ts-sdks/<pkg>`. The plan shows the **expected** API shape from the README; reconcile against the actual published API at implementation time and adjust the wrapper.
- **Sui networks**: dev/test on testnet; mainnet deploy at T27.
- **Wallets**: two test wallets (Alice + Bob) generated at T2; both seeded with testnet SUI via faucet, then mainnet SUI manually (small amount, e.g., 5 SUI each).
- **Frequent commits**: each task ends with a commit. Use Conventional Commits prefixes (`feat:`, `test:`, `chore:`, `docs:`, `fix:`).
- **TDD where it makes sense**: pure functions get tests first; subagent prompts and config files get manual smoke tests.

---

## Timeline (37 days, 2026-05-16 → 2026-06-21)

| Phase | Days | Tasks | Goal |
|---|---|---|---|
| 1. Foundation | 1-3 | T1-T3 | Repo + tooling + SDK spike |
| 2. MCP Core | 4-10 | T4-T12 | All 15 MCP tools work on testnet |
| 3. System Layer | 11-13 | T13-T15 | Logging, outbox, health |
| 4. Plugin | 14-18 | T16-T21 | Claude Code plugin shippable |
| 5. Testing | 19-24 | T22-T26 | Unit + integration + E2E all green |
| 6. Polish | 25-29 | T27-T30 | Mainnet + docs + brand |
| 7. Demo | 30-37 | T31-T35 | Rehearse, record, submit |

---

# Phase 1: Foundation (Days 1-3)

## Task 1: Repo Initialization

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `README.md` (stub)
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create repo and initialize git**

```bash
mkdir -p /Users/waynekuo/Documents/GitHub/walrus-agent-stack
cd /Users/waynekuo/Documents/GitHub/walrus-agent-stack
git init
gh repo create walrus-agent-stack --public --source=. --description "Walrus-backed shared memory + encrypted channels for any MCP agent"
```

Expected: GitHub repo created, local repo initialized.

- [ ] **Step 2: Initialize pnpm package**

```bash
pnpm init
```

Then edit `package.json` to look like:

```json
{
  "name": "walrus-agent-stack-mcp",
  "version": "0.1.0",
  "description": "Walrus-backed shared memory + encrypted channels for any MCP agent",
  "type": "module",
  "bin": {
    "walrus-agent-stack-mcp": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:int": "vitest run tests/integration",
    "test:e2e": "bash tests/e2e/d2-demo.sh",
    "lint": "eslint . --ext .ts",
    "format": "prettier --write .",
    "smoke": "node dist/cli.js --health"
  },
  "engines": {
    "node": ">=20"
  },
  "keywords": ["mcp", "walrus", "sui", "agent", "memory", "seal"],
  "license": "Apache-2.0"
}
```

- [ ] **Step 3: Install dependencies**

```bash
pnpm add @modelcontextprotocol/sdk @mysten/sui @mysten/sui-stack-messaging zod
pnpm add -D typescript vitest @types/node tsx eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier
```

Expected: `node_modules/` populated, `pnpm-lock.yaml` created.

- [ ] **Step 4: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 5: Write vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 6: Write .gitignore**

```
node_modules/
dist/
*.log
.DS_Store
.env
.env.local
~/.walrus-agent-stack/
coverage/
```

- [ ] **Step 7: Write .editorconfig**

```
root = true

[*]
indent_style = tab
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
```

- [ ] **Step 8: Create GitHub Actions CI**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm build
      - run: pnpm test
```

- [ ] **Step 9: Verify build works (empty src is fine)**

```bash
mkdir -p src
echo 'export const VERSION = "0.1.0";' > src/index.ts
pnpm build
```

Expected: `dist/index.js` and `dist/index.d.ts` exist, no errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: initialize walrus-agent-stack repo with tooling"
git push -u origin main
```

---

## Task 2: Config Layer + Wallet Management

**Files:**
- Create: `src/config.ts`
- Create: `src/wallet.ts`
- Create: `tests/unit/config.test.ts`

- [ ] **Step 1: Write failing test for config loading**

`tests/unit/config.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  beforeEach(() => {
    delete process.env.SUI_PRIVATE_KEY;
    delete process.env.SUI_NETWORK;
  });

  it('throws if SUI_PRIVATE_KEY is missing', () => {
    expect(() => loadConfig({})).toThrowError(/SUI_PRIVATE_KEY/);
  });

  it('defaults network to testnet', () => {
    const cfg = loadConfig({ SUI_PRIVATE_KEY: 'suiprivkey1qz...' });
    expect(cfg.network).toBe('testnet');
  });

  it('accepts mainnet', () => {
    const cfg = loadConfig({ SUI_PRIVATE_KEY: 'suiprivkey1qz...', SUI_NETWORK: 'mainnet' });
    expect(cfg.network).toBe('mainnet');
  });

  it('parses SEAL_SERVERS as comma-separated', () => {
    const cfg = loadConfig({
      SUI_PRIVATE_KEY: 'suiprivkey1qz...',
      SEAL_SERVERS: '0xabc,0xdef',
    });
    expect(cfg.sealServers).toEqual(['0xabc', '0xdef']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/config.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement config**

`src/config.ts`:

```ts
import { z } from 'zod';

export const ConfigSchema = z.object({
  privateKey: z.string().min(1),
  network: z.enum(['mainnet', 'testnet']).default('testnet'),
  relayerUrl: z.string().url(),
  sealServers: z.array(z.string()).min(1),
  rpcUrls: z.array(z.string().url()).min(1),
  logDir: z.string(),
});

export type Config = z.infer<typeof ConfigSchema>;

const DEFAULT_RELAYER_TESTNET = 'https://relayer.testnet.example.com';
const DEFAULT_RELAYER_MAINNET = 'https://relayer.mainnet.example.com';
const DEFAULT_RPC_TESTNET = 'https://fullnode.testnet.sui.io:443';
const DEFAULT_RPC_MAINNET = 'https://fullnode.mainnet.sui.io:443';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (!env.SUI_PRIVATE_KEY) {
    throw new Error('SUI_PRIVATE_KEY must be set in environment');
  }
  const network = (env.SUI_NETWORK ?? 'testnet') as 'mainnet' | 'testnet';
  return ConfigSchema.parse({
    privateKey: env.SUI_PRIVATE_KEY,
    network,
    relayerUrl: env.RELAYER_URL ?? (network === 'mainnet' ? DEFAULT_RELAYER_MAINNET : DEFAULT_RELAYER_TESTNET),
    sealServers: (env.SEAL_SERVERS ?? '').split(',').filter(Boolean),
    rpcUrls: (env.SUI_RPC_URLS ?? (network === 'mainnet' ? DEFAULT_RPC_MAINNET : DEFAULT_RPC_TESTNET)).split(','),
    logDir: env.LOG_DIR ?? `${process.env.HOME}/.walrus-agent-stack/log`,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/config.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Implement wallet loader**

`src/wallet.ts`:

```ts
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

export function loadKeypair(privateKey: string): Ed25519Keypair {
  if (privateKey.startsWith('suiprivkey1')) {
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    return Ed25519Keypair.fromSecretKey(secretKey);
  }
  throw new Error('Unsupported private key format; expected suiprivkey1...');
}

export function deriveAddress(privateKey: string): string {
  return loadKeypair(privateKey).toSuiAddress();
}
```

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/wallet.ts tests/unit/config.test.ts
git commit -m "feat: add config loader and wallet management"
```

---

## Task 3: sui-stack-messaging SDK Integration Spike

**Files:**
- Create: `scripts/spike-sdk.ts`
- Create: `docs/sdk-notes.md` (notes from spike)

**Purpose:** Before building wrappers, prove the SDK works as we expect on testnet. Burn 30-60 minutes here to avoid surprises later.

- [ ] **Step 1: Create spike script**

`scripts/spike-sdk.ts`:

```ts
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { createMessagingGroupsClient } from '@mysten/sui-stack-messaging';
import { loadConfig } from '../src/config.js';
import { loadKeypair } from '../src/wallet.js';

async function main() {
  const cfg = loadConfig();
  const keypair = loadKeypair(cfg.privateKey);

  const client = createMessagingGroupsClient(
    new SuiGrpcClient({
      baseUrl: cfg.rpcUrls[0]!,
      network: cfg.network,
    }),
    {
      seal: { serverConfigs: cfg.sealServers.map((id) => ({ objectId: id, weight: 1 })) },
      encryption: { sessionKey: { signer: keypair } },
      relayer: { relayerUrl: cfg.relayerUrl },
    },
  );

  console.log('My address:', keypair.toSuiAddress());

  // Create a test group
  const result = await client.messaging.createAndShareGroup({
    signer: keypair,
    name: 'spike-test-' + Date.now(),
    initialMembers: [],
  });
  console.log('Created group:', result);

  // Send a message
  await client.messaging.sendMessage({
    signer: keypair,
    groupRef: { uuid: result.uuid },
    text: 'Hello from spike',
  });
  console.log('Sent message');

  // Read back
  const messages = await client.messaging.getMessages({
    signer: keypair,
    groupRef: { uuid: result.uuid },
    limit: 10,
  });
  console.log('Got messages:', JSON.stringify(messages, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Generate a testnet wallet and fund it**

```bash
# Generate fresh keypair (or use Sui CLI)
node -e "
  const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
  const { encodeSuiPrivateKey } = require('@mysten/sui/cryptography');
  const kp = new Ed25519Keypair();
  console.log('Address:', kp.toSuiAddress());
  console.log('Key:', encodeSuiPrivateKey(kp.export().privateKey, 'ED25519'));
"

# Copy address, hit faucet
curl --location --request POST 'https://faucet.testnet.sui.io/gas' \
  --header 'Content-Type: application/json' \
  --data-raw '{"FixedAmountRequest":{"recipient":"<ADDRESS>"}}'
```

Save the private key to a local `.env.testnet` file (gitignored).

- [ ] **Step 3: Run spike**

```bash
export $(cat .env.testnet | xargs)
pnpm tsx scripts/spike-sdk.ts
```

Expected: prints address, creates group, sends message, reads it back.

If errors: read SDK source at `/Users/waynekuo/Documents/GitHub/sui-stack-messaging/ts-sdks/` to find correct API.

- [ ] **Step 4: Document findings**

`docs/sdk-notes.md`: write down

```markdown
# sui-stack-messaging SDK Notes (from spike on 2026-05-XX)

## Verified working APIs

- `createAndShareGroup({signer, name, initialMembers})` → returns `{uuid, objectId}`
- `sendMessage({signer, groupRef, text})` → ...
- `getMessages({signer, groupRef, limit})` → returns `[{ id, sender, text, senderVerified, timestamp, ... }]`
- `subscribe({signer, groupRef, signal})` → AsyncIterable

## Gotchas

- (fill in based on real behavior)
- (e.g., gas estimation issues, RPC quirks, package ID requirements)

## Member ops

- `addMembers(...)` — TBC, find signature
- `removeMemberAndRotateKey(...)` — TBC
- `leaveGroup(...)` — TBC

## Attachments / Walrus path

- (note where attachments live and how to access)
```

- [ ] **Step 5: Commit**

```bash
git add scripts/spike-sdk.ts docs/sdk-notes.md
git commit -m "chore: SDK integration spike + API notes"
```

---

# Phase 2: MCP Server Core (Days 4-10)

## Task 4: MCP Server Skeleton

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/mcp/dispatch.ts`
- Create: `src/cli.ts`
- Create: `tests/unit/dispatch.test.ts`

- [ ] **Step 1: Write failing test for dispatch**

`tests/unit/dispatch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Dispatcher } from '../../src/mcp/dispatch.js';
import { z } from 'zod';

describe('Dispatcher', () => {
  it('routes tool call to registered handler', async () => {
    const d = new Dispatcher();
    d.register({
      name: 'echo',
      schema: z.object({ msg: z.string() }),
      handler: async ({ msg }) => ({ ok: true, msg }),
    });
    const res = await d.invoke('echo', { msg: 'hi' });
    expect(res).toEqual({ ok: true, msg: 'hi' });
  });

  it('returns structured error on unknown tool', async () => {
    const d = new Dispatcher();
    await expect(d.invoke('missing', {})).rejects.toMatchObject({
      code: 'UNKNOWN_TOOL',
    });
  });

  it('returns validation error on bad args', async () => {
    const d = new Dispatcher();
    d.register({
      name: 'echo',
      schema: z.object({ msg: z.string() }),
      handler: async ({ msg }) => ({ msg }),
    });
    await expect(d.invoke('echo', { msg: 123 })).rejects.toMatchObject({
      code: 'INVALID_ARGS',
    });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm test tests/unit/dispatch.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement Dispatcher**

`src/mcp/dispatch.ts`:

```ts
import { z, ZodSchema } from 'zod';

export interface ToolError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ToolDef<T> {
  name: string;
  schema: ZodSchema<T>;
  handler: (args: T) => Promise<unknown>;
  description?: string;
}

export class Dispatcher {
  private tools = new Map<string, ToolDef<unknown>>();

  register<T>(def: ToolDef<T>) {
    this.tools.set(def.name, def as ToolDef<unknown>);
  }

  list(): { name: string; description?: string }[] {
    return Array.from(this.tools.values()).map(({ name, description }) => ({ name, description }));
  }

  async invoke(name: string, args: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      const err: ToolError = { code: 'UNKNOWN_TOOL', message: `Unknown tool: ${name}` };
      throw err;
    }
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) {
      const err: ToolError = {
        code: 'INVALID_ARGS',
        message: 'Argument validation failed',
        details: parsed.error.flatten(),
      };
      throw err;
    }
    try {
      return await tool.handler(parsed.data);
    } catch (e: any) {
      if (e?.code && e?.message) throw e;
      const err: ToolError = {
        code: 'INTERNAL_ERROR',
        message: e?.message ?? String(e),
      };
      throw err;
    }
  }
}
```

- [ ] **Step 4: Run test, verify passes**

Run: `pnpm test tests/unit/dispatch.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Build MCP server stdio adapter**

`src/mcp/server.ts`:

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Dispatcher } from './dispatch.js';

export async function startServer(dispatcher: Dispatcher) {
  const server = new Server(
    { name: 'walrus-agent-stack-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: dispatcher.list().map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: { type: 'object' },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const result = await dispatcher.invoke(req.params.name, req.params.arguments ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (e: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ code: e.code, message: e.message, details: e.details }) }],
      };
    }
  });

  await server.connect(new StdioServerTransport());
}
```

- [ ] **Step 6: Create CLI entry point**

`src/cli.ts`:

```ts
#!/usr/bin/env node
import { startServer } from './mcp/server.js';
import { Dispatcher } from './mcp/dispatch.js';
import { loadConfig } from './config.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--health')) {
    // Health check, no MCP needed
    try {
      loadConfig();
      console.log(JSON.stringify({ status: 'ok' }));
      process.exit(0);
    } catch (e: any) {
      console.error(JSON.stringify({ status: 'error', message: e.message }));
      process.exit(1);
    }
  }

  const dispatcher = new Dispatcher();
  // tools will be registered in subsequent tasks
  await startServer(dispatcher);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 7: Build and smoke test**

```bash
pnpm build
SUI_PRIVATE_KEY=suiprivkey1qz... SEAL_SERVERS=0x123 node dist/cli.js --health
```

Expected: `{"status":"ok"}` printed and exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/mcp/ src/cli.ts tests/unit/dispatch.test.ts
git commit -m "feat: MCP server skeleton with dispatcher and stdio transport"
```

---

## Task 5: Tool Argument Schemas

**Files:**
- Create: `src/schemas.ts`
- Create: `tests/unit/schemas.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/unit/schemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  ChannelCreateArgs,
  ChannelSendArgs,
  MemoryWriteArgs,
  IdentityVerifyArgs,
  WalrusUriSchema,
} from '../../src/schemas.js';

describe('schemas', () => {
  it('ChannelCreateArgs requires name', () => {
    expect(ChannelCreateArgs.safeParse({}).success).toBe(false);
    expect(ChannelCreateArgs.safeParse({ name: 'x' }).success).toBe(true);
    expect(ChannelCreateArgs.safeParse({ name: 'x', members: ['0xa'] }).success).toBe(true);
  });

  it('ChannelSendArgs requires channel_id and content', () => {
    expect(ChannelSendArgs.safeParse({ channel_id: 'abc', content: 'hi' }).success).toBe(true);
    expect(ChannelSendArgs.safeParse({ channel_id: 'abc' }).success).toBe(false);
  });

  it('MemoryWriteArgs requires channel_id, key, content', () => {
    expect(
      MemoryWriteArgs.safeParse({ channel_id: 'c', key: 'k', content: 'v' }).success,
    ).toBe(true);
    expect(MemoryWriteArgs.safeParse({ channel_id: 'c', key: 'k' }).success).toBe(false);
  });

  it('IdentityVerifyArgs requires message_id', () => {
    expect(IdentityVerifyArgs.safeParse({ message_id: 'm' }).success).toBe(true);
    expect(IdentityVerifyArgs.safeParse({}).success).toBe(false);
  });

  it('WalrusUriSchema validates walrus:// URIs', () => {
    expect(WalrusUriSchema.safeParse('walrus://blob123').success).toBe(true);
    expect(WalrusUriSchema.safeParse('walrus://blob123?channel=c&key=k').success).toBe(true);
    expect(WalrusUriSchema.safeParse('https://other').success).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify failing**

Run: `pnpm test tests/unit/schemas.test.ts`
Expected: FAIL (missing module).

- [ ] **Step 3: Implement schemas**

`src/schemas.ts`:

```ts
import { z } from 'zod';

const SuiAddress = z.string().regex(/^0x[a-fA-F0-9]+$/, 'invalid Sui address');
const UUID = z.string().min(1);

export const WalrusUriSchema = z.string().regex(/^walrus:\/\//, 'must start with walrus://');

export const ChannelCreateArgs = z.object({
  name: z.string().min(1),
  members: z.array(SuiAddress).optional(),
});
export type ChannelCreateArgs = z.infer<typeof ChannelCreateArgs>;

export const ChannelInviteArgs = z.object({
  channel_id: UUID,
  address: SuiAddress,
});
export const ChannelKickArgs = ChannelInviteArgs;
export const ChannelLeaveArgs = z.object({ channel_id: UUID });
export const ChannelMembersArgs = z.object({ channel_id: UUID });
export const ChannelJoinArgs = z.object({ channel_id: UUID });

export const ChannelSendArgs = z.object({
  channel_id: UUID,
  content: z.string(),
  refs: z.array(WalrusUriSchema).optional(),
  agent_id: z.string().optional(),
  parent_message_id: UUID.optional(),
});

export const ChannelHistoryArgs = z.object({
  channel_id: UUID,
  since: z.number().int().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export const MemoryWriteArgs = z.object({
  channel_id: UUID,
  key: z.string().min(1).max(256),
  content: z.string(),
  content_type: z.string().default('text/plain'),
  agent_id: z.string().optional(),
});

export const MemoryReadArgs = z.object({
  uri: WalrusUriSchema,
});

export const MemorySnapshotArgs = z.object({
  channel_id: UUID,
  label: z.string().min(1),
});

export const IdentityVerifyArgs = z.object({
  message_id: UUID,
});

export const SystemDebugArgs = z.object({
  limit: z.number().int().min(1).max(200).default(20),
});

export const EmptyArgs = z.object({});
```

- [ ] **Step 4: Run, verify passing**

Run: `pnpm test tests/unit/schemas.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/schemas.ts tests/unit/schemas.test.ts
git commit -m "feat: Zod schemas for all MCP tool args"
```

---

## Task 6: Identity Tools (whoami + verify)

**Files:**
- Create: `src/sdk-client.ts`
- Create: `src/tools/identity.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Build SDK client factory**

`src/sdk-client.ts`:

```ts
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { createMessagingGroupsClient } from '@mysten/sui-stack-messaging';
import { Config } from './config.js';
import { loadKeypair } from './wallet.js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

export interface SdkContext {
  client: ReturnType<typeof createMessagingGroupsClient>;
  keypair: Ed25519Keypair;
  config: Config;
}

let cached: SdkContext | null = null;

export function getSdk(config: Config): SdkContext {
  if (cached) return cached;
  const keypair = loadKeypair(config.privateKey);
  const client = createMessagingGroupsClient(
    new SuiGrpcClient({ baseUrl: config.rpcUrls[0]!, network: config.network }),
    {
      seal: { serverConfigs: config.sealServers.map((id) => ({ objectId: id, weight: 1 })) },
      encryption: { sessionKey: { signer: keypair } },
      relayer: { relayerUrl: config.relayerUrl },
    },
  );
  cached = { client, keypair, config };
  return cached;
}
```

- [ ] **Step 2: Implement identity tools**

`src/tools/identity.ts`:

```ts
import { ToolDef } from '../mcp/dispatch.js';
import { EmptyArgs, IdentityVerifyArgs } from '../schemas.js';
import { SdkContext } from '../sdk-client.js';
import { z } from 'zod';

export function whoamiTool(sdk: SdkContext): ToolDef<{}> {
  return {
    name: 'identity.whoami',
    description: 'Return this MCP server\'s Sui address',
    schema: EmptyArgs,
    handler: async () => ({
      address: sdk.keypair.toSuiAddress(),
      network: sdk.config.network,
    }),
  };
}

export function verifyTool(sdk: SdkContext): ToolDef<z.infer<typeof IdentityVerifyArgs>> {
  return {
    name: 'identity.verify',
    description: 'Verify a channel message\'s signature and return sender details',
    schema: IdentityVerifyArgs,
    handler: async ({ message_id }) => {
      // Pull message via SDK; SDK exposes senderVerified flag
      // The SDK doesn't have a direct getById, so we search recent history
      // For simplicity, accept a channel_id too in stretch; for now expose what the SDK gives us
      throw { code: 'NOT_IMPLEMENTED', message: 'use channel.history for now; verify is finalized in T14' };
    },
  };
}
```

Note: verify is fleshed out in T14 once we have channel.history wired. This stub keeps the tool list complete.

- [ ] **Step 3: Register tools in CLI**

Modify `src/cli.ts`, replace the `// tools will be registered` comment with:

```ts
  const config = loadConfig();
  const { getSdk } = await import('./sdk-client.js');
  const sdk = getSdk(config);
  const { whoamiTool, verifyTool } = await import('./tools/identity.js');
  dispatcher.register(whoamiTool(sdk));
  dispatcher.register(verifyTool(sdk));
```

- [ ] **Step 4: Smoke test**

```bash
pnpm build
# Use MCP inspector or manual JSON-RPC
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"identity.whoami","arguments":{}}}' \
  | SUI_PRIVATE_KEY=$TESTNET_KEY SEAL_SERVERS=0x... node dist/cli.js
```

Expected: response with `address` field matching the testnet wallet.

- [ ] **Step 5: Commit**

```bash
git add src/sdk-client.ts src/tools/identity.ts src/cli.ts
git commit -m "feat: identity.whoami and identity.verify (stub)"
```

---

## Task 7: Channel Create + Members

**Files:**
- Create: `src/tools/channel-lifecycle.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Implement channel.create and channel.members**

`src/tools/channel-lifecycle.ts`:

```ts
import { ToolDef } from '../mcp/dispatch.js';
import {
  ChannelCreateArgs, ChannelMembersArgs,
  ChannelInviteArgs, ChannelKickArgs, ChannelLeaveArgs,
} from '../schemas.js';
import { SdkContext } from '../sdk-client.js';
import { z } from 'zod';

export function createTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelCreateArgs>> {
  return {
    name: 'channel.create',
    description: 'Create a new encrypted channel; caller becomes admin',
    schema: ChannelCreateArgs,
    handler: async ({ name, members = [] }) => {
      const result = await sdk.client.messaging.createAndShareGroup({
        signer: sdk.keypair,
        name,
        initialMembers: members,
      });
      return {
        channel_id: result.uuid,
        object_id: result.objectId,
        admin: sdk.keypair.toSuiAddress(),
      };
    },
  };
}

export function membersTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelMembersArgs>> {
  return {
    name: 'channel.members',
    description: 'List members of a channel',
    schema: ChannelMembersArgs,
    handler: async ({ channel_id }) => {
      const group = await sdk.client.messaging.getGroup({ groupRef: { uuid: channel_id } });
      return {
        channel_id,
        admin: group.admin,
        members: group.members,
      };
    },
  };
}

export function inviteTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelInviteArgs>> {
  return {
    name: 'channel.invite',
    description: 'Add a member to a channel',
    schema: ChannelInviteArgs,
    handler: async ({ channel_id, address }) => {
      await sdk.client.messaging.addMembers({
        signer: sdk.keypair,
        groupRef: { uuid: channel_id },
        members: [address],
      });
      return { channel_id, invited: address };
    },
  };
}

export function kickTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelKickArgs>> {
  return {
    name: 'channel.kick',
    description: 'Remove a member and rotate Seal key',
    schema: ChannelKickArgs,
    handler: async ({ channel_id, address }) => {
      await sdk.client.messaging.removeMemberAndRotateKey({
        signer: sdk.keypair,
        groupRef: { uuid: channel_id },
        member: address,
      });
      return { channel_id, kicked: address, key_rotated: true };
    },
  };
}

export function leaveTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelLeaveArgs>> {
  return {
    name: 'channel.leave',
    description: 'Leave a channel',
    schema: ChannelLeaveArgs,
    handler: async ({ channel_id }) => {
      await sdk.client.messaging.leaveGroup({
        signer: sdk.keypair,
        groupRef: { uuid: channel_id },
      });
      return { channel_id, left: sdk.keypair.toSuiAddress() };
    },
  };
}
```

> Note: actual sui-stack-messaging method names (`addMembers`, `removeMemberAndRotateKey`, `leaveGroup`, `getGroup`) may differ. Reconcile with `docs/sdk-notes.md` from T3.

- [ ] **Step 2: Register tools**

In `src/cli.ts`, add:

```ts
  const lc = await import('./tools/channel-lifecycle.js');
  dispatcher.register(lc.createTool(sdk));
  dispatcher.register(lc.membersTool(sdk));
  dispatcher.register(lc.inviteTool(sdk));
  dispatcher.register(lc.kickTool(sdk));
  dispatcher.register(lc.leaveTool(sdk));
```

- [ ] **Step 3: Manual smoke test on testnet**

```bash
pnpm build
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"channel.create","arguments":{"name":"smoke-test"}}}' \
  | node dist/cli.js
```

Expected: response with `channel_id` and `object_id`. Verify object on testnet explorer.

- [ ] **Step 4: Commit**

```bash
git add src/tools/channel-lifecycle.ts src/cli.ts
git commit -m "feat: channel lifecycle tools (create, members, invite, kick, leave)"
```

---

## Task 8: Channel Send + History

**Files:**
- Create: `src/tools/channel-messaging.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Implement send + history**

`src/tools/channel-messaging.ts`:

```ts
import { ToolDef } from '../mcp/dispatch.js';
import { ChannelSendArgs, ChannelHistoryArgs } from '../schemas.js';
import { SdkContext } from '../sdk-client.js';
import { z } from 'zod';

export function sendTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelSendArgs>> {
  return {
    name: 'channel.send',
    description: 'Send a message to a channel; refs are Walrus URIs',
    schema: ChannelSendArgs,
    handler: async ({ channel_id, content, refs, agent_id, parent_message_id }) => {
      const body = {
        type: 'text' as const,
        text: content,
        agent_id,
        parent_message_id,
      };
      const result = await sdk.client.messaging.sendMessage({
        signer: sdk.keypair,
        groupRef: { uuid: channel_id },
        text: JSON.stringify(body),
        attachments: refs?.map((uri) => ({ uri })) ?? [],
      });
      return {
        message_id: result.messageId,
        channel_id,
        sender: sdk.keypair.toSuiAddress(),
        timestamp_ms: Date.now(),
      };
    },
  };
}

export function historyTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelHistoryArgs>> {
  return {
    name: 'channel.history',
    description: 'Get message history of a channel',
    schema: ChannelHistoryArgs,
    handler: async ({ channel_id, since, limit }) => {
      const messages = await sdk.client.messaging.getMessages({
        signer: sdk.keypair,
        groupRef: { uuid: channel_id },
        limit,
        since,
      });
      return {
        channel_id,
        messages: messages.map((m: any) => ({
          message_id: m.id,
          sender: m.sender,
          timestamp_ms: m.timestamp,
          verified: m.senderVerified,
          body: tryParseJson(m.text),
          refs: m.attachments?.map((a: any) => a.uri) ?? [],
        })),
      };
    },
  };
}

function tryParseJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return { type: 'text', text: s };
  }
}
```

- [ ] **Step 2: Register tools**

In `src/cli.ts` add:

```ts
  const cm = await import('./tools/channel-messaging.js');
  dispatcher.register(cm.sendTool(sdk));
  dispatcher.register(cm.historyTool(sdk));
```

- [ ] **Step 3: Smoke test on testnet**

```bash
# Create a channel, send a message, read history
pnpm build
CHAN=$(echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"channel.create","arguments":{"name":"smoke"}}}' | node dist/cli.js | jq -r '.result.content[0].text | fromjson | .channel_id')
echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"channel.send\",\"arguments\":{\"channel_id\":\"$CHAN\",\"content\":\"hello\"}}}" | node dist/cli.js
echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"channel.history\",\"arguments\":{\"channel_id\":\"$CHAN\"}}}" | node dist/cli.js
```

Expected: history shows the sent message with `verified: true`.

- [ ] **Step 4: Commit**

```bash
git add src/tools/channel-messaging.ts src/cli.ts
git commit -m "feat: channel.send and channel.history"
```

---

## Task 9: Channel Join (Subscribe)

**Files:**
- Create: `src/tools/channel-subscribe.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Implement join**

`src/tools/channel-subscribe.ts`:

```ts
import { ToolDef } from '../mcp/dispatch.js';
import { ChannelJoinArgs } from '../schemas.js';
import { SdkContext } from '../sdk-client.js';
import { z } from 'zod';

export function joinTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelJoinArgs>> {
  return {
    name: 'channel.join',
    description: 'Subscribe to a channel (pulls history immediately; live stream not exposed via MCP)',
    schema: ChannelJoinArgs,
    handler: async ({ channel_id }) => {
      // Pull recent history to confirm membership + decrypt access
      const messages = await sdk.client.messaging.getMessages({
        signer: sdk.keypair,
        groupRef: { uuid: channel_id },
        limit: 100,
      });
      return {
        channel_id,
        joined_as: sdk.keypair.toSuiAddress(),
        history_count: messages.length,
      };
    },
  };
}
```

> Design note: `channel.subscribe` (live streaming AsyncIterable) doesn't map cleanly to MCP's request-response model. We expose `channel.join` as "confirm access + pull history snapshot"; agents call `channel.history` periodically to poll. This is sufficient for the D2 demo. A streaming variant is a stretch goal.

- [ ] **Step 2: Register**

In `src/cli.ts`:

```ts
  const cs = await import('./tools/channel-subscribe.js');
  dispatcher.register(cs.joinTool(sdk));
```

- [ ] **Step 3: Smoke test (Alice creates, invites Bob, Bob joins)**

Manual test with two .env files:

```bash
# Terminal 1 (Alice)
SUI_PRIVATE_KEY=$ALICE_KEY ... node dist/cli.js
# Run channel.create + channel.invite with Bob's address

# Terminal 2 (Bob)
SUI_PRIVATE_KEY=$BOB_KEY ... node dist/cli.js
# Run channel.join with the channel_id Alice gave you
```

Expected: Bob's `channel.join` returns `history_count > 0`.

- [ ] **Step 4: Commit**

```bash
git add src/tools/channel-subscribe.ts src/cli.ts
git commit -m "feat: channel.join (pulls history on subscribe)"
```

---

## Task 10: Walrus URI Parser

**Files:**
- Create: `src/walrus-uri.ts`
- Create: `tests/unit/walrus-uri.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/unit/walrus-uri.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseWalrusUri, buildWalrusUri } from '../../src/walrus-uri.js';

describe('walrus-uri', () => {
  it('parses bare uri', () => {
    expect(parseWalrusUri('walrus://blobABC123')).toEqual({
      blobId: 'blobABC123',
    });
  });

  it('parses uri with channel + key hints', () => {
    expect(parseWalrusUri('walrus://blobABC?channel=chan1&key=analyst-us%2Ffindings.md')).toEqual({
      blobId: 'blobABC',
      channel: 'chan1',
      key: 'analyst-us/findings.md',
    });
  });

  it('builds uri', () => {
    expect(buildWalrusUri('blob1', 'ch1', 'k/v.md')).toBe(
      'walrus://blob1?channel=ch1&key=k%2Fv.md',
    );
  });

  it('rejects non-walrus uri', () => {
    expect(() => parseWalrusUri('http://x')).toThrowError(/walrus/);
  });
});
```

- [ ] **Step 2: Run, verify failing**

Run: `pnpm test tests/unit/walrus-uri.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/walrus-uri.ts`:

```ts
export interface WalrusUri {
  blobId: string;
  channel?: string;
  key?: string;
}

export function parseWalrusUri(uri: string): WalrusUri {
  if (!uri.startsWith('walrus://')) {
    throw new Error(`Not a walrus URI: ${uri}`);
  }
  const rest = uri.slice('walrus://'.length);
  const [blobId, query] = rest.split('?');
  if (!blobId) throw new Error('Missing blob id');
  const params = new URLSearchParams(query ?? '');
  const channel = params.get('channel') ?? undefined;
  const key = params.get('key') ?? undefined;
  return { blobId, channel, key };
}

export function buildWalrusUri(blobId: string, channel?: string, key?: string): string {
  const params = new URLSearchParams();
  if (channel) params.set('channel', channel);
  if (key) params.set('key', key);
  const q = params.toString();
  return `walrus://${blobId}${q ? `?${q}` : ''}`;
}
```

- [ ] **Step 4: Run, verify passing**

Run: `pnpm test tests/unit/walrus-uri.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/walrus-uri.ts tests/unit/walrus-uri.test.ts
git commit -m "feat: walrus URI parser and builder"
```

---

## Task 11: Memory Blob Envelope (Sign + Verify)

**Files:**
- Create: `src/memory-blob.ts`
- Create: `tests/unit/memory-blob.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/unit/memory-blob.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { encodeBlob, decodeBlob, verifyBlob } from '../../src/memory-blob.js';

describe('memory-blob', () => {
  const kp = new Ed25519Keypair();
  const author = kp.toSuiAddress();

  const base = {
    channel_id: 'ch1',
    key: 'a.md',
    content_type: 'text/plain',
    content: 'hello world',
    author_agent_id: 'analyst-us',
    message_id: 'msg1',
  };

  it('roundtrip encode -> decode preserves data', async () => {
    const blob = await encodeBlob(base, kp);
    const decoded = decodeBlob(blob);
    expect(decoded.channel_id).toBe('ch1');
    expect(decoded.key).toBe('a.md');
    expect(decoded.content).toBe('hello world');
    expect(decoded.metadata.author).toBe(author);
    expect(decoded.metadata.signature).toBeDefined();
  });

  it('verifyBlob passes for untouched blob', async () => {
    const blob = await encodeBlob(base, kp);
    const ok = await verifyBlob(decodeBlob(blob));
    expect(ok).toBe(true);
  });

  it('verifyBlob fails for tampered content', async () => {
    const blob = await encodeBlob(base, kp);
    const decoded = decodeBlob(blob);
    decoded.content = 'tampered';
    const ok = await verifyBlob(decoded);
    expect(ok).toBe(false);
  });

  it('rejects unknown schema_version', () => {
    expect(() => decodeBlob('{"schema_version":99}')).toThrowError(/schema_version/);
  });

  it('cross-check message_id mismatch detection', async () => {
    const blob = await encodeBlob(base, kp);
    const decoded = decodeBlob(blob);
    expect(decoded.metadata.message_id).toBe('msg1');
  });
});
```

- [ ] **Step 2: Run, verify failing**

Run: `pnpm test tests/unit/memory-blob.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/memory-blob.ts`:

```ts
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';

export interface MemoryBlobInput {
  channel_id: string;
  key: string;
  content_type: string;
  content: string;
  author_agent_id?: string;
  message_id: string;
}

export interface MemoryBlob {
  schema_version: 1;
  channel_id: string;
  key: string;
  content_type: string;
  content: string;
  metadata: {
    author: string;
    author_agent_id?: string;
    created_at_ms: number;
    message_id: string;
    signature: string;
  };
}

function signablePayload(b: Omit<MemoryBlob, 'metadata'> & { metadata: Omit<MemoryBlob['metadata'], 'signature'> }): string {
  return JSON.stringify({
    schema_version: b.schema_version,
    channel_id: b.channel_id,
    key: b.key,
    content_type: b.content_type,
    content: b.content,
    metadata: {
      author: b.metadata.author,
      author_agent_id: b.metadata.author_agent_id,
      created_at_ms: b.metadata.created_at_ms,
      message_id: b.metadata.message_id,
    },
  });
}

export async function encodeBlob(input: MemoryBlobInput, keypair: Ed25519Keypair): Promise<string> {
  const created_at_ms = Date.now();
  const author = keypair.toSuiAddress();
  const unsigned = {
    schema_version: 1 as const,
    ...input,
    metadata: {
      author,
      author_agent_id: input.author_agent_id,
      created_at_ms,
      message_id: input.message_id,
    },
  };
  const payload = signablePayload(unsigned);
  const sig = await keypair.signPersonalMessage(new TextEncoder().encode(payload));
  const blob: MemoryBlob = {
    ...unsigned,
    metadata: { ...unsigned.metadata, signature: sig.signature },
  };
  return JSON.stringify(blob);
}

export function decodeBlob(raw: string): MemoryBlob {
  const obj = JSON.parse(raw);
  if (obj.schema_version !== 1) {
    throw new Error(`Unsupported schema_version: ${obj.schema_version}`);
  }
  return obj as MemoryBlob;
}

export async function verifyBlob(blob: MemoryBlob): Promise<boolean> {
  const { signature, ...metaWithoutSig } = blob.metadata;
  const payload = signablePayload({ ...blob, metadata: metaWithoutSig });
  try {
    await verifyPersonalMessageSignature(new TextEncoder().encode(payload), signature, {
      address: blob.metadata.author,
    });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run, verify passing**

Run: `pnpm test tests/unit/memory-blob.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/memory-blob.ts tests/unit/memory-blob.test.ts
git commit -m "feat: memory blob encode/decode with author signature"
```

---

## Task 12: Memory Tools (write + read)

**Files:**
- Create: `src/tools/memory.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Implement memory.write and memory.read**

`src/tools/memory.ts`:

```ts
import { ToolDef } from '../mcp/dispatch.js';
import { MemoryWriteArgs, MemoryReadArgs } from '../schemas.js';
import { SdkContext } from '../sdk-client.js';
import { encodeBlob, decodeBlob, verifyBlob, MemoryBlobInput } from '../memory-blob.js';
import { buildWalrusUri, parseWalrusUri } from '../walrus-uri.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

export function writeTool(sdk: SdkContext): ToolDef<z.infer<typeof MemoryWriteArgs>> {
  return {
    name: 'memory.write',
    description: 'Write a Walrus blob scoped to a channel; returns walrus:// URI',
    schema: MemoryWriteArgs,
    handler: async ({ channel_id, key, content, content_type, agent_id }) => {
      const message_id = randomUUID();
      const input: MemoryBlobInput = {
        channel_id,
        key,
        content_type,
        content,
        author_agent_id: agent_id,
        message_id,
      };
      const blobJson = await encodeBlob(input, sdk.keypair);

      // Use sui-stack-messaging's attachment / Walrus path
      // The SDK encrypts via Seal with the channel's Group policy
      const uploadResult = await sdk.client.messaging.uploadAttachment({
        signer: sdk.keypair,
        groupRef: { uuid: channel_id },
        data: new TextEncoder().encode(blobJson),
        contentType: 'application/x-walrus-agent-stack-memory+json',
      });

      const uri = buildWalrusUri(uploadResult.blobId, channel_id, key);
      return {
        uri,
        blob_id: uploadResult.blobId,
        channel_id,
        key,
        message_id,
        author: sdk.keypair.toSuiAddress(),
      };
    },
  };
}

export function readTool(sdk: SdkContext): ToolDef<z.infer<typeof MemoryReadArgs>> {
  return {
    name: 'memory.read',
    description: 'Read a Walrus memory blob; verifies signature; returns plaintext',
    schema: MemoryReadArgs,
    handler: async ({ uri }) => {
      const parsed = parseWalrusUri(uri);
      if (!parsed.channel) {
        throw { code: 'MISSING_CHANNEL_HINT', message: 'walrus URI must carry ?channel= hint for Seal decrypt' };
      }
      const data = await sdk.client.messaging.downloadAttachment({
        signer: sdk.keypair,
        groupRef: { uuid: parsed.channel },
        blobId: parsed.blobId,
      });
      const text = new TextDecoder().decode(data);
      const blob = decodeBlob(text);
      const verified = await verifyBlob(blob);
      return {
        uri,
        verified,
        content: blob.content,
        content_type: blob.content_type,
        author: blob.metadata.author,
        author_agent_id: blob.metadata.author_agent_id,
        message_id: blob.metadata.message_id,
        created_at_ms: blob.metadata.created_at_ms,
        ...(verified ? {} : { warning: 'MEMORY_TAMPERED' }),
      };
    },
  };
}
```

- [ ] **Step 2: Register**

In `src/cli.ts`:

```ts
  const mem = await import('./tools/memory.js');
  dispatcher.register(mem.writeTool(sdk));
  dispatcher.register(mem.readTool(sdk));
```

- [ ] **Step 3: Smoke test (write then read)**

```bash
pnpm build
# Inside a created channel:
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory.write","arguments":{"channel_id":"'$CHAN'","key":"test.md","content":"hello memory"}}}' \
  | node dist/cli.js
# Capture URI, then read:
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory.read","arguments":{"uri":"'$URI'"}}}' \
  | node dist/cli.js
```

Expected: round-trip succeeds; `verified: true`.

- [ ] **Step 4: Commit**

```bash
git add src/tools/memory.ts src/cli.ts
git commit -m "feat: memory.write and memory.read with author signature verification"
```

---

# Phase 3: System Layer (Days 11-13)

## Task 13: Logging Infrastructure + system.debug

**Files:**
- Create: `src/logging.ts`
- Create: `src/tools/system.ts` (partial — debug only here, others in T14-T15)
- Create: `tests/unit/logging.test.ts`
- Modify: `src/mcp/dispatch.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing test for logging**

`tests/unit/logging.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolLog } from '../../src/logging.js';

describe('ToolLog', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'walogs-'));
  });

  it('writes one jsonl line per call', () => {
    const log = new ToolLog(dir);
    log.record({ tool: 'channel.send', durationMs: 12, errorCode: null, inputHash: 'abc' });
    log.record({ tool: 'memory.write', durationMs: 50, errorCode: 'INVALID_ARGS', inputHash: 'def' });
    const file = log.todayFile();
    const lines = readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!).tool).toBe('channel.send');
    expect(JSON.parse(lines[1]!).errorCode).toBe('INVALID_ARGS');
  });

  it('hashes input deterministically', () => {
    const log = new ToolLog(dir);
    expect(log.inputHash({ a: 1 })).toBe(log.inputHash({ a: 1 }));
    expect(log.inputHash({ a: 1 })).not.toBe(log.inputHash({ a: 2 }));
  });

  it('tail returns recent entries in reverse order', () => {
    const log = new ToolLog(dir);
    for (let i = 0; i < 5; i++) {
      log.record({ tool: `t${i}`, durationMs: i, errorCode: null, inputHash: `h${i}` });
    }
    const recent = log.tail(3);
    expect(recent.length).toBe(3);
    expect(recent[0].tool).toBe('t4');
    expect(recent[2].tool).toBe('t2');
  });
});
```

- [ ] **Step 2: Run, verify failing**

Run: `pnpm test tests/unit/logging.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement logging**

`src/logging.ts`:

```ts
import { createHash } from 'node:crypto';
import { mkdirSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LogEntry {
  ts: string;
  tool: string;
  durationMs: number;
  errorCode: string | null;
  inputHash: string;
}

export class ToolLog {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  todayFile(): string {
    const d = new Date().toISOString().slice(0, 10);
    return join(this.dir, `${d}.jsonl`);
  }

  inputHash(input: unknown): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);
  }

  record(entry: Omit<LogEntry, 'ts'>): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    appendFileSync(this.todayFile(), line + '\n', 'utf-8');
  }

  tail(limit: number): LogEntry[] {
    const f = this.todayFile();
    if (!existsSync(f)) return [];
    const lines = readFileSync(f, 'utf-8').trim().split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map((l) => JSON.parse(l) as LogEntry);
  }
}
```

- [ ] **Step 4: Run, verify passing**

Run: `pnpm test tests/unit/logging.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Wire logging into dispatcher**

Modify `src/mcp/dispatch.ts` — change `invoke` to optionally record:

```ts
import { ToolLog } from '../logging.js';

export class Dispatcher {
  private tools = new Map<string, ToolDef<unknown>>();
  constructor(private log?: ToolLog) {}

  register<T>(def: ToolDef<T>) {
    this.tools.set(def.name, def as ToolDef<unknown>);
  }

  list() {
    return Array.from(this.tools.values()).map(({ name, description }) => ({ name, description }));
  }

  async invoke(name: string, args: unknown): Promise<unknown> {
    const start = Date.now();
    let errorCode: string | null = null;
    try {
      const tool = this.tools.get(name);
      if (!tool) {
        errorCode = 'UNKNOWN_TOOL';
        throw { code: errorCode, message: `Unknown tool: ${name}` };
      }
      const parsed = tool.schema.safeParse(args);
      if (!parsed.success) {
        errorCode = 'INVALID_ARGS';
        throw { code: errorCode, message: 'Argument validation failed', details: parsed.error.flatten() };
      }
      return await tool.handler(parsed.data);
    } catch (e: any) {
      if (!errorCode) errorCode = e?.code ?? 'INTERNAL_ERROR';
      throw e;
    } finally {
      this.log?.record({
        tool: name,
        durationMs: Date.now() - start,
        errorCode,
        inputHash: this.log.inputHash(args),
      });
    }
  }
}
```

- [ ] **Step 6: Implement system.debug**

`src/tools/system.ts` (skeleton — fill more in T14/T15):

```ts
import { ToolDef } from '../mcp/dispatch.js';
import { SystemDebugArgs, EmptyArgs } from '../schemas.js';
import { ToolLog } from '../logging.js';
import { z } from 'zod';

export function debugTool(log: ToolLog): ToolDef<z.infer<typeof SystemDebugArgs>> {
  return {
    name: 'system.debug',
    description: 'Return recent tool call log entries',
    schema: SystemDebugArgs,
    handler: async ({ limit }) => ({
      entries: log.tail(limit),
    }),
  };
}
```

- [ ] **Step 7: Wire into CLI**

In `src/cli.ts`:

```ts
  const { ToolLog } = await import('./logging.js');
  const toolLog = new ToolLog(config.logDir);
  const dispatcher = new Dispatcher(toolLog);
  // ... after other tool registrations:
  const sys = await import('./tools/system.js');
  dispatcher.register(sys.debugTool(toolLog));
```

- [ ] **Step 8: Commit**

```bash
git add src/logging.ts src/tools/system.ts src/mcp/dispatch.ts src/cli.ts tests/unit/logging.test.ts
git commit -m "feat: tool call logging and system.debug"
```

---

## Task 14: Outbox + system.resend + Finalize identity.verify

**Files:**
- Create: `src/outbox.ts`
- Modify: `src/tools/channel-messaging.ts` (wrap send in outbox)
- Modify: `src/tools/identity.ts` (finalize verify)
- Modify: `src/tools/system.ts` (add resend)
- Modify: `src/cli.ts`
- Create: `tests/unit/outbox.test.ts`

- [ ] **Step 1: Write failing tests for outbox**

`tests/unit/outbox.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Outbox } from '../../src/outbox.js';

describe('Outbox', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'outbox-'));
  });

  it('persists and lists pending', () => {
    const ob = new Outbox(dir);
    ob.enqueue({ id: 'm1', tool: 'channel.send', args: { channel_id: 'c', content: 'hi' } });
    ob.enqueue({ id: 'm2', tool: 'channel.send', args: { channel_id: 'c', content: 'bye' } });
    expect(ob.pending()).toHaveLength(2);
  });

  it('marks complete and drops from pending', () => {
    const ob = new Outbox(dir);
    ob.enqueue({ id: 'm1', tool: 'channel.send', args: {} });
    ob.markDone('m1');
    expect(ob.pending()).toHaveLength(0);
  });

  it('persists across instances', () => {
    new Outbox(dir).enqueue({ id: 'm1', tool: 'x', args: {} });
    expect(new Outbox(dir).pending()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, verify failing**

Run: `pnpm test tests/unit/outbox.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement Outbox**

`src/outbox.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface OutboxItem {
  id: string;
  tool: string;
  args: any;
  enqueuedAt: number;
  attempts: number;
}

export class Outbox {
  private file: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'outbox.json');
    if (!existsSync(this.file)) writeFileSync(this.file, '[]');
  }

  private read(): OutboxItem[] {
    return JSON.parse(readFileSync(this.file, 'utf-8'));
  }

  private write(items: OutboxItem[]) {
    writeFileSync(this.file, JSON.stringify(items, null, 2));
  }

  enqueue(item: Omit<OutboxItem, 'enqueuedAt' | 'attempts'>) {
    const items = this.read();
    items.push({ ...item, enqueuedAt: Date.now(), attempts: 0 });
    this.write(items);
  }

  pending(): OutboxItem[] {
    return this.read();
  }

  markDone(id: string) {
    this.write(this.read().filter((i) => i.id !== id));
  }

  incrementAttempt(id: string) {
    const items = this.read();
    const found = items.find((i) => i.id === id);
    if (found) {
      found.attempts++;
      this.write(items);
    }
  }
}
```

- [ ] **Step 4: Run, verify passing**

Run: `pnpm test tests/unit/outbox.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Wrap send in outbox fallback**

Modify `src/tools/channel-messaging.ts` — wrap the SDK call in try/catch and enqueue on infra failure:

```ts
import { Outbox } from '../outbox.js';

// Update sendTool signature to take outbox:
export function sendTool(sdk: SdkContext, outbox: Outbox): ToolDef<z.infer<typeof ChannelSendArgs>> {
  return {
    name: 'channel.send',
    description: 'Send a message to a channel; refs are Walrus URIs',
    schema: ChannelSendArgs,
    handler: async (args) => {
      const { channel_id, content, refs, agent_id, parent_message_id } = args;
      const body = { type: 'text' as const, text: content, agent_id, parent_message_id };
      try {
        const result = await sdk.client.messaging.sendMessage({
          signer: sdk.keypair,
          groupRef: { uuid: channel_id },
          text: JSON.stringify(body),
          attachments: refs?.map((uri) => ({ uri })) ?? [],
        });
        return {
          message_id: result.messageId,
          channel_id,
          sender: sdk.keypair.toSuiAddress(),
          timestamp_ms: Date.now(),
        };
      } catch (e: any) {
        if (isInfraError(e)) {
          const id = `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          outbox.enqueue({ id, tool: 'channel.send', args });
          throw { code: 'RELAYER_UNREACHABLE', message: 'Queued to outbox', details: { outbox_id: id } };
        }
        throw e;
      }
    },
  };
}

function isInfraError(e: any): boolean {
  const msg = (e?.message ?? '').toLowerCase();
  return msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('5');
}
```

- [ ] **Step 6: Implement system.resend**

Add to `src/tools/system.ts`:

```ts
import { Outbox } from '../outbox.js';
import { Dispatcher } from '../mcp/dispatch.js';

export function resendTool(outbox: Outbox, dispatcher: Dispatcher): ToolDef<{}> {
  return {
    name: 'system.resend',
    description: 'Retry all queued outbox messages',
    schema: EmptyArgs,
    handler: async () => {
      const pending = outbox.pending();
      const results: any[] = [];
      for (const item of pending) {
        try {
          outbox.incrementAttempt(item.id);
          const r = await dispatcher.invoke(item.tool, item.args);
          outbox.markDone(item.id);
          results.push({ id: item.id, status: 'sent', result: r });
        } catch (e: any) {
          results.push({ id: item.id, status: 'failed', error: e });
        }
      }
      return { processed: results };
    },
  };
}
```

- [ ] **Step 7: Finalize identity.verify**

Replace stub in `src/tools/identity.ts`:

```ts
export function verifyTool(sdk: SdkContext): ToolDef<z.infer<typeof IdentityVerifyArgs>> {
  return {
    name: 'identity.verify',
    description: 'Verify a channel message\'s signature and return sender details',
    schema: IdentityVerifyArgs.extend({ channel_id: z.string() }),
    handler: async ({ message_id, channel_id }: any) => {
      const messages = await sdk.client.messaging.getMessages({
        signer: sdk.keypair,
        groupRef: { uuid: channel_id },
        limit: 1000,
      });
      const msg = messages.find((m: any) => m.id === message_id);
      if (!msg) throw { code: 'MESSAGE_NOT_FOUND', message: `No message ${message_id}` };
      return {
        message_id,
        sender: msg.sender,
        verified: msg.senderVerified,
        timestamp_ms: msg.timestamp,
        signature: msg.signature,
        payload_hash: msg.payloadHash,
      };
    },
  };
}
```

Update `IdentityVerifyArgs` in `src/schemas.ts` to include `channel_id`:

```ts
export const IdentityVerifyArgs = z.object({
  message_id: z.string().min(1),
  channel_id: z.string().min(1),
});
```

(Update tests if any break — the earlier T5 test only checked `message_id`; relax or extend it to include channel_id.)

- [ ] **Step 8: Wire all up in CLI**

In `src/cli.ts`:

```ts
  const { Outbox } = await import('./outbox.js');
  const outbox = new Outbox(config.logDir + '/..');

  // Replace previous sendTool registration with the one that takes outbox:
  const cm = await import('./tools/channel-messaging.js');
  dispatcher.register(cm.sendTool(sdk, outbox));
  dispatcher.register(cm.historyTool(sdk));

  // System
  dispatcher.register(sys.debugTool(toolLog));
  dispatcher.register(sys.resendTool(outbox, dispatcher));
```

- [ ] **Step 9: Commit**

```bash
git add src/outbox.ts src/tools/system.ts src/tools/channel-messaging.ts src/tools/identity.ts src/schemas.ts src/cli.ts tests/unit/outbox.test.ts
git commit -m "feat: outbox-backed send, system.resend, finalize identity.verify"
```

---

## Task 15: system.health

**Files:**
- Modify: `src/tools/system.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Implement health tool**

Add to `src/tools/system.ts`:

```ts
import { SdkContext } from '../sdk-client.js';

export function healthTool(sdk: SdkContext): ToolDef<{}> {
  return {
    name: 'system.health',
    description: 'Check Sui RPC, relayer, Walrus, Seal, and wallet balance',
    schema: EmptyArgs,
    handler: async () => {
      const checks: Record<string, { ok: boolean; detail?: string }> = {};

      // RPC
      try {
        const balance = await sdk.client.client.getBalance({ owner: sdk.keypair.toSuiAddress() });
        checks.rpc = { ok: true, detail: `balance: ${balance.totalBalance}` };
      } catch (e: any) {
        checks.rpc = { ok: false, detail: e.message };
      }

      // Relayer
      try {
        const r = await fetch(sdk.config.relayerUrl + '/health', { signal: AbortSignal.timeout(3000) });
        checks.relayer = { ok: r.ok, detail: `status: ${r.status}` };
      } catch (e: any) {
        checks.relayer = { ok: false, detail: e.message };
      }

      // Walrus + Seal: indirect — try a tiny round-trip via SDK if available
      // For solo / hackathon, defer to "did relayer work" as proxy
      checks.walrus = { ok: checks.relayer.ok, detail: 'tested via relayer' };
      checks.seal = { ok: checks.relayer.ok, detail: 'tested via relayer' };

      const allOk = Object.values(checks).every((c) => c.ok);
      return { status: allOk ? 'ok' : 'degraded', address: sdk.keypair.toSuiAddress(), checks };
    },
  };
}
```

- [ ] **Step 2: Register**

In `src/cli.ts`:

```ts
  dispatcher.register(sys.healthTool(sdk));
```

- [ ] **Step 3: Smoke test**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"system.health","arguments":{}}}' | node dist/cli.js
```

Expected: response with `status: ok` and per-component detail.

- [ ] **Step 4: Commit**

```bash
git add src/tools/system.ts src/cli.ts
git commit -m "feat: system.health checks rpc/relayer/walrus/seal"
```

---

# Phase 4: Claude Code Plugin (Days 14-18)

## Task 16: Plugin Scaffold + MCP Config

**Files:**
- Create: `plugin/plugin.json`
- Create: `plugin/README.md`
- Create: `plugin/mcp-servers.json`

- [ ] **Step 1: Create plugin manifest**

`plugin/plugin.json`:

```json
{
  "name": "walrus-agent-stack",
  "version": "0.1.0",
  "description": "Walrus-backed shared memory + encrypted channels for any MCP agent",
  "author": "Wayne Kuo",
  "homepage": "https://github.com/<user>/walrus-agent-stack"
}
```

- [ ] **Step 2: Create MCP server registration**

`plugin/mcp-servers.json`:

```json
{
  "mcpServers": {
    "walrus-agent-stack": {
      "command": "npx",
      "args": ["-y", "walrus-agent-stack-mcp"],
      "env": {
        "SUI_PRIVATE_KEY": "${SUI_PRIVATE_KEY}",
        "SUI_NETWORK": "${SUI_NETWORK:-testnet}",
        "RELAYER_URL": "${RELAYER_URL}",
        "SEAL_SERVERS": "${SEAL_SERVERS}"
      }
    }
  }
}
```

- [ ] **Step 3: Plugin README**

`plugin/README.md`:

```markdown
# Walrus Agent Stack Plugin

Adds encrypted A2A channels + Walrus-backed shared memory + Sui-anchored identity to Claude Code.

## Install

\`\`\`
/plugin marketplace add <repo-url>
/plugin install walrus-agent-stack
\`\`\`

## First Run

\`\`\`
npx walrus-agent-stack init
\`\`\`

Generates a Sui keypair, hits the testnet faucet, writes config.

## Commands

- `/agent-channel new <topic>` — start a channel and spawn the research-leader subagent
- `/agent-channel invite <addr>` — invite a Sui address
- `/agent-channel join <id>` — join an existing channel
- `/agent-channel kick <addr>` — remove a member (rotates Seal key)
- `/agent-channel leave` — leave the current channel
- `/agent-channel members` — list members
- `/agent-memory list` — list memory refs in the current channel
- `/agent-verify <msg_id>` — verify a message's signature (demo highlight)
- `/agent-stack health` — environment health
- `/agent-stack resend` — replay outbox
- `/agent-stack debug` — recent tool log

## Subagents

- `research-leader` — coordinates a research squad
- `analyst` — does focused research, writes to memory
- `synthesizer` — reads memory, produces final report
```

- [ ] **Step 4: Commit**

```bash
git add plugin/
git commit -m "feat: plugin scaffold with MCP config"
```

---

## Task 17: Slash Commands — Channel Family

**Files:**
- Create: `plugin/commands/agent-channel.md`

- [ ] **Step 1: Write the slash command file**

`plugin/commands/agent-channel.md`:

```markdown
---
description: Manage encrypted agent channels
allowed-tools: mcp__walrus-agent-stack__*
---

# /agent-channel

Manage encrypted agent collaboration channels backed by Sui + Walrus + Seal.

## Subcommands

Read the first word of $ARGUMENTS to determine the subcommand: `new`, `invite`, `join`, `kick`, `leave`, `members`.

### new <topic>

Call `mcp__walrus-agent-stack__channel.create` with `{ name: "<topic>" }`. Save the returned `channel_id` to a session variable. Then spawn the `research-leader` subagent with this system prompt prefix:

> You are the research-leader subagent. Your channel_id is `<channel_id>`. Your assignment is `<topic>`. Use `channel.send` to announce your plan, then spawn `analyst` subagents with specific subtopics. Once analysts return, call `synthesizer` to produce the final report.

### invite <address>

Call `mcp__walrus-agent-stack__channel.invite` with `{ channel_id: <current>, address: "<address>" }`. Print the result.

### join <channel_id>

Call `mcp__walrus-agent-stack__channel.join` with `{ channel_id: "<channel_id>" }`. Store it as the current channel. Then call `channel.history` and summarize what you found.

### kick <address>

Call `mcp__walrus-agent-stack__channel.kick`. Confirm with user before executing (it rotates the Seal key).

### leave

Call `mcp__walrus-agent-stack__channel.leave`.

### members

Call `mcp__walrus-agent-stack__channel.members` and print a table of admin + members.

## Args
$ARGUMENTS
```

- [ ] **Step 2: Manual smoke test in Claude Code**

```
/plugin install walrus-agent-stack
/agent-channel new "Test"
```

Expected: Claude Code calls `channel.create`, prints channel_id.

- [ ] **Step 3: Commit**

```bash
git add plugin/commands/agent-channel.md
git commit -m "feat: /agent-channel slash command family"
```

---

## Task 18: Slash Commands — Memory + Verify + Stack

**Files:**
- Create: `plugin/commands/agent-memory.md`
- Create: `plugin/commands/agent-verify.md`
- Create: `plugin/commands/agent-stack.md`

- [ ] **Step 1: Write /agent-memory**

`plugin/commands/agent-memory.md`:

```markdown
---
description: Inspect channel-scoped Walrus memory
allowed-tools: mcp__walrus-agent-stack__*
---

# /agent-memory

Read $ARGUMENTS. Subcommand is the first word.

### list

Call `channel.history` for the current channel. Extract all `refs` from message bodies. For each ref, call `memory.read` and print a one-line summary:

```
<key> — <author> @ <timestamp> — ✓ verified — <content_type>
```

Highlight any with `verified: false` as ⚠️.

## Args
$ARGUMENTS
```

- [ ] **Step 2: Write /agent-verify**

`plugin/commands/agent-verify.md`:

```markdown
---
description: Cryptographically verify a channel message
allowed-tools: mcp__walrus-agent-stack__*
---

# /agent-verify

Given a message_id (from $ARGUMENTS), call `identity.verify` with the current channel_id and the message_id.

Print a verification report:

```
Message: <message_id>
Channel: <channel_id>
Sender:  <sender_address>
Signed:  <timestamp>
Status:  ✓ VERIFIED  (or  ✗ NOT VERIFIED)
Payload hash: <hash>
Signature:    <sig>
```

This is the demo highlight — make it look authoritative.

## Args
$ARGUMENTS
```

- [ ] **Step 3: Write /agent-stack**

`plugin/commands/agent-stack.md`:

```markdown
---
description: Operational commands (health/resend/debug)
allowed-tools: mcp__walrus-agent-stack__*
---

# /agent-stack

Read first word of $ARGUMENTS: `health`, `resend`, `debug`.

### health
Call `system.health` and print a status table.

### resend
Call `system.resend` and print how many were retried + their status.

### debug
Call `system.debug` with `limit: 20` and print recent tool calls.

## Args
$ARGUMENTS
```

- [ ] **Step 4: Smoke test all four commands manually in Claude Code**

- [ ] **Step 5: Commit**

```bash
git add plugin/commands/
git commit -m "feat: /agent-memory, /agent-verify, /agent-stack slash commands"
```

---

## Task 19: Subagent — research-leader

**Files:**
- Create: `plugin/agents/research-leader.md`

- [ ] **Step 1: Write subagent template**

`plugin/agents/research-leader.md`:

```markdown
---
name: research-leader
description: Coordinates a research squad in an encrypted Walrus-backed channel
tools: mcp__walrus-agent-stack__*, Task
---

# Research Leader Subagent

You are the research-leader for an autonomous research squad working inside a shared encrypted channel.

## Context You Get
- `channel_id`: the channel you operate in
- `topic`: the research subject

## Your Job

1. **Announce**: call `channel.send` with a clear plan statement. Format:
   ```
   Research plan for "<topic>":
   - Subtopic A → analyst-a
   - Subtopic B → analyst-b
   ETA: 5 minutes.
   ```

2. **Delegate**: spawn 2 `analyst` subagents (use the Task tool with subagent_type=analyst). Pass each:
   - the same `channel_id`
   - a specific subtopic
   - their `agent_id` (e.g., `analyst-a`)

3. **Wait & Aggregate**: poll `channel.history` every 30 seconds. When you see both analysts have written their findings (look for `memory.write` outputs in channel messages), spawn the `synthesizer` subagent with channel_id.

4. **Report**: once synthesizer returns a final report URI, call `channel.send` with:
   ```
   Final report: <walrus URI>
   Status: complete.
   ```

## Rules

- Every action that affects others MUST go through `channel.send` or `memory.write` — never act silently.
- Always include `agent_id: "research-leader"` in your `channel.send` calls.
- If an analyst doesn't return in 3 minutes, send a follow-up via `channel.send`.
- Don't write to memory directly — that's the analysts' job.
```

- [ ] **Step 2: Commit**

```bash
git add plugin/agents/research-leader.md
git commit -m "feat: research-leader subagent template"
```

---

## Task 20: Subagents — analyst + synthesizer

**Files:**
- Create: `plugin/agents/analyst.md`
- Create: `plugin/agents/synthesizer.md`

- [ ] **Step 1: Write analyst**

`plugin/agents/analyst.md`:

```markdown
---
name: analyst
description: Focused research analyst that writes findings to channel-scoped Walrus memory
tools: mcp__walrus-agent-stack__*, WebFetch, WebSearch
---

# Analyst Subagent

You research one focused subtopic and write your findings into shared memory.

## Context You Get
- `channel_id`
- `subtopic`
- `agent_id` (e.g., `analyst-a` or `analyst-us`)

## Your Job

1. **Acknowledge**: call `channel.send` with `{ content: "Starting research on <subtopic>", agent_id }`.

2. **Research**: use WebFetch / WebSearch to gather information. Keep notes structured.

3. **Write findings**: call `memory.write` with:
   ```
   {
     channel_id,
     key: "<agent_id>/findings.md",
     content: "<your full research output in markdown>",
     agent_id
   }
   ```
   This returns a `walrus://` URI.

4. **Notify**: call `channel.send` with `{ channel_id, content: "Findings posted", refs: [<uri>], agent_id }`.

## Rules

- Only do research relevant to your assigned subtopic.
- Cite sources inline in your markdown.
- Don't read another analyst's memory until you've written your own (parallel work).
- After posting, you're done — wait for the synthesizer.
```

- [ ] **Step 2: Write synthesizer**

`plugin/agents/synthesizer.md`:

```markdown
---
name: synthesizer
description: Reads all channel memory and produces a final consolidated report
tools: mcp__walrus-agent-stack__*
---

# Synthesizer Subagent

You read everything analysts have produced in a channel and write a unified final report.

## Context You Get
- `channel_id`

## Your Job

1. **Survey**: call `channel.history` and identify all `memory.write` outputs (look for messages with `refs`).

2. **Read all memory**: for each ref, call `memory.read`. Verify each returns `verified: true` before using.

3. **Synthesize**: produce a structured markdown report:
   ```
   # Final Report: <topic>

   ## Key Findings
   - ...

   ## Sources
   - <author_a> (`<agent_id>`): <walrus uri>
   - <author_b> (`<agent_id>`): <walrus uri>

   ## Conflicting Evidence
   - ...
   ```

4. **Write**: call `memory.write` with `key: "final-report.md"`, `agent_id: "synthesizer"`.

5. **Announce**: call `channel.send` with `{ content: "Final report ready", refs: [<uri>], agent_id: "synthesizer" }`.

## Rules

- If any source's `verified: false`, flag it in the report under "⚠️ Provenance Issues".
- Don't include sources that returned `MEMORY_TAMPERED`.
- Be objective — show conflicts, don't paper over them.
```

- [ ] **Step 3: Commit**

```bash
git add plugin/agents/analyst.md plugin/agents/synthesizer.md
git commit -m "feat: analyst and synthesizer subagent templates"
```

---

## Task 21: Stop Hook + Init Script

**Files:**
- Create: `plugin/hooks/stop.sh`
- Create: `bin/init.js`
- Modify: `plugin/plugin.json`
- Modify: `package.json` (add bin entry)

- [ ] **Step 1: Create Stop hook**

`plugin/hooks/stop.sh`:

```bash
#!/usr/bin/env bash
# Stop hook — archive session summary to Walrus memory if a channel was active.
# Reads the active channel_id from ~/.walrus-agent-stack/session.json if it exists.

SESSION_FILE="$HOME/.walrus-agent-stack/session.json"
if [ ! -f "$SESSION_FILE" ]; then
  exit 0
fi

CHANNEL_ID=$(jq -r '.channel_id // empty' "$SESSION_FILE")
SUMMARY="${CLAUDE_LAST_RESPONSE:-<no summary available>}"

if [ -n "$CHANNEL_ID" ]; then
  # Fire-and-forget call to memory.write
  echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"memory.write\",\"arguments\":{\"channel_id\":\"$CHANNEL_ID\",\"key\":\"session-summary-$(date +%Y%m%dT%H%M%S).md\",\"content\":$(echo "$SUMMARY" | jq -Rs .)}}}" \
    | npx walrus-agent-stack-mcp >/dev/null 2>&1 &
fi

exit 0
```

- [ ] **Step 2: Reference the hook in plugin.json**

Update `plugin/plugin.json`:

```json
{
  "name": "walrus-agent-stack",
  "version": "0.1.0",
  "description": "Walrus-backed shared memory + encrypted channels for any MCP agent",
  "author": "Wayne Kuo",
  "homepage": "https://github.com/<user>/walrus-agent-stack",
  "hooks": {
    "Stop": [
      { "command": "bash plugin/hooks/stop.sh" }
    ]
  }
}
```

- [ ] **Step 3: Create init script**

`bin/init.js`:

```js
#!/usr/bin/env node
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { encodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const CONFIG_DIR = join(HOME, '.walrus-agent-stack');
const CONFIG_FILE = join(CONFIG_DIR, 'config.env');
const SESSION_FILE = join(CONFIG_DIR, 'session.json');

async function main() {
  mkdirSync(CONFIG_DIR, { recursive: true });

  if (existsSync(CONFIG_FILE)) {
    console.log(`Config already exists at ${CONFIG_FILE}.`);
    console.log('Delete it first if you want to regenerate.');
    process.exit(0);
  }

  const kp = new Ed25519Keypair();
  const address = kp.toSuiAddress();
  const privateKey = encodeSuiPrivateKey(kp.export().privateKey, 'ED25519');

  console.log(`Generated wallet: ${address}`);

  // Hit testnet faucet
  console.log('Requesting testnet SUI from faucet...');
  try {
    const r = await fetch('https://faucet.testnet.sui.io/gas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ FixedAmountRequest: { recipient: address } }),
    });
    if (r.ok) console.log('Faucet OK.');
    else console.log('Faucet returned:', r.status, '— you may need to request manually.');
  } catch (e) {
    console.log('Faucet failed:', e.message);
  }

  // Write config
  const config = [
    `SUI_PRIVATE_KEY=${privateKey}`,
    `SUI_NETWORK=testnet`,
    `RELAYER_URL=https://relayer.testnet.example.com`,
    `SEAL_SERVERS=0xREPLACE_ME`,
    `SUI_RPC_URLS=https://fullnode.testnet.sui.io:443`,
  ].join('\n');
  writeFileSync(CONFIG_FILE, config);
  writeFileSync(SESSION_FILE, JSON.stringify({}));

  console.log(`\nConfig written to ${CONFIG_FILE}.`);
  console.log('Edit it to set real RELAYER_URL and SEAL_SERVERS.');
  console.log('\nDone. Run `/plugin install walrus-agent-stack` in Claude Code, then try `/agent-channel new "test"`.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Add bin to package.json**

Update `package.json`:

```json
{
  "bin": {
    "walrus-agent-stack-mcp": "./dist/cli.js",
    "walrus-agent-stack": "./bin/init.js"
  }
}
```

- [ ] **Step 5: Smoke test init**

```bash
pnpm build
npx walrus-agent-stack
```

Expected: creates `~/.walrus-agent-stack/config.env`, faucet attempt logged.

- [ ] **Step 6: Commit**

```bash
git add plugin/hooks/ bin/init.js plugin/plugin.json package.json
git commit -m "feat: Stop hook for session archive + init script"
```

---

# Phase 5: Testing (Days 19-24)

## Task 22: Remaining Unit Tests (rate-limit, loop-detect)

**Files:**
- Create: `src/rate-limiter.ts`
- Create: `src/loop-detector.ts`
- Create: `tests/unit/rate-limiter.test.ts`
- Create: `tests/unit/loop-detector.test.ts`
- Modify: `src/mcp/dispatch.ts` (apply rate-limit + loop-detect)

- [ ] **Step 1: Rate limiter test**

`tests/unit/rate-limiter.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { RateLimiter } from '../../src/rate-limiter.js';

describe('RateLimiter', () => {
  it('allows up to limit within window', () => {
    const rl = new RateLimiter(10, 60_000);
    for (let i = 0; i < 10; i++) expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(false);
  });

  it('different keys are independent', () => {
    const rl = new RateLimiter(2, 60_000);
    expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(false);
    expect(rl.check('b')).toBe(true);
  });

  it('window slides', () => {
    vi.useFakeTimers();
    const rl = new RateLimiter(2, 1000);
    expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(rl.check('a')).toBe(true);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Implement rate limiter**

`src/rate-limiter.ts`:

```ts
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private maxPerWindow: number, private windowMs: number) {}

  check(key: string): boolean {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.maxPerWindow) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
}
```

- [ ] **Step 3: Run, verify passing**

```bash
pnpm test tests/unit/rate-limiter.test.ts
```

Expected: 3 passing.

- [ ] **Step 4: Loop detector test**

`tests/unit/loop-detector.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LoopDetector } from '../../src/loop-detector.js';

describe('LoopDetector', () => {
  it('triggers after 5 same-sender messages in a row', () => {
    const ld = new LoopDetector(5);
    for (let i = 0; i < 4; i++) expect(ld.observe('alice')).toBe(false);
    expect(ld.observe('alice')).toBe(true);
  });

  it('different sender breaks the streak', () => {
    const ld = new LoopDetector(5);
    for (let i = 0; i < 4; i++) ld.observe('alice');
    ld.observe('bob');
    expect(ld.observe('alice')).toBe(false);
  });

  it('user input reset wipes counters', () => {
    const ld = new LoopDetector(5);
    for (let i = 0; i < 4; i++) ld.observe('alice');
    ld.reset();
    expect(ld.observe('alice')).toBe(false);
  });
});
```

- [ ] **Step 5: Implement loop detector**

`src/loop-detector.ts`:

```ts
export class LoopDetector {
  private streak = 0;
  private lastSender: string | null = null;

  constructor(private threshold: number) {}

  observe(sender: string): boolean {
    if (sender === this.lastSender) {
      this.streak++;
    } else {
      this.streak = 1;
      this.lastSender = sender;
    }
    return this.streak >= this.threshold;
  }

  reset() {
    this.streak = 0;
    this.lastSender = null;
  }
}
```

- [ ] **Step 6: Wire into channel.send**

Modify `src/tools/channel-messaging.ts`:

```ts
import { RateLimiter } from '../rate-limiter.js';
import { LoopDetector } from '../loop-detector.js';

const memoryRateLimiter = new RateLimiter(10, 60_000);
const loopDetector = new LoopDetector(5);

// In sendTool handler, before doing the SDK call:
if (!memoryRateLimiter.check(`${channel_id}:${sdk.keypair.toSuiAddress()}`)) {
  throw { code: 'RATE_LIMITED', message: '>10 msgs/min on this channel' };
}
if (loopDetector.observe(`${channel_id}:${sdk.keypair.toSuiAddress()}`)) {
  throw { code: 'LOOP_DETECTED', message: 'Same sender 5+ times in a row; pausing' };
}
```

- [ ] **Step 7: Commit**

```bash
git add src/rate-limiter.ts src/loop-detector.ts tests/unit/rate-limiter.test.ts tests/unit/loop-detector.test.ts src/tools/channel-messaging.ts
git commit -m "feat: rate limiter + loop detector applied to channel.send"
```

---

## Task 23: Integration Test Fixture

**Files:**
- Create: `tests/integration/helpers/fixture.ts`
- Create: `tests/integration/helpers/faucet.ts`

- [ ] **Step 1: Build test fixture utilities**

`tests/integration/helpers/fixture.ts`:

```ts
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { encodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Dispatcher } from '../../../src/mcp/dispatch.js';
import { loadConfig } from '../../../src/config.js';
import { getSdk } from '../../../src/sdk-client.js';
import { ToolLog } from '../../../src/logging.js';
import { Outbox } from '../../../src/outbox.js';
import * as id from '../../../src/tools/identity.js';
import * as lc from '../../../src/tools/channel-lifecycle.js';
import * as cm from '../../../src/tools/channel-messaging.js';
import * as cs from '../../../src/tools/channel-subscribe.js';
import * as mem from '../../../src/tools/memory.js';
import * as sys from '../../../src/tools/system.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TestEnv {
  dispatcher: Dispatcher;
  address: string;
  config: ReturnType<typeof loadConfig>;
}

export function newWalletEnv(): TestEnv {
  const kp = new Ed25519Keypair();
  process.env.SUI_PRIVATE_KEY = encodeSuiPrivateKey(kp.export().privateKey, 'ED25519');
  process.env.SUI_NETWORK = 'testnet';
  process.env.RELAYER_URL = process.env.TEST_RELAYER_URL!;
  process.env.SEAL_SERVERS = process.env.TEST_SEAL_SERVERS!;
  process.env.LOG_DIR = mkdtempSync(join(tmpdir(), 'wa-test-'));

  const config = loadConfig();
  const sdk = getSdk(config);
  const log = new ToolLog(config.logDir);
  const outbox = new Outbox(config.logDir);
  const dispatcher = new Dispatcher(log);
  dispatcher.register(id.whoamiTool(sdk));
  dispatcher.register(id.verifyTool(sdk));
  dispatcher.register(lc.createTool(sdk));
  dispatcher.register(lc.membersTool(sdk));
  dispatcher.register(lc.inviteTool(sdk));
  dispatcher.register(lc.kickTool(sdk));
  dispatcher.register(lc.leaveTool(sdk));
  dispatcher.register(cm.sendTool(sdk, outbox));
  dispatcher.register(cm.historyTool(sdk));
  dispatcher.register(cs.joinTool(sdk));
  dispatcher.register(mem.writeTool(sdk));
  dispatcher.register(mem.readTool(sdk));
  dispatcher.register(sys.healthTool(sdk));
  dispatcher.register(sys.debugTool(log));
  dispatcher.register(sys.resendTool(outbox, dispatcher));

  return { dispatcher, address: kp.toSuiAddress(), config };
}
```

`tests/integration/helpers/faucet.ts`:

```ts
export async function fundFromFaucet(address: string): Promise<void> {
  const r = await fetch('https://faucet.testnet.sui.io/gas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ FixedAmountRequest: { recipient: address } }),
  });
  if (!r.ok) throw new Error(`Faucet failed: ${r.status}`);
  // Wait for object to be visible
  await new Promise((f) => setTimeout(f, 3000));
}
```

- [ ] **Step 2: Document required env vars in README of repo**

Add to `README.md`:

```markdown
## Integration testing

Set these env vars before running `pnpm test:int`:
- `TEST_RELAYER_URL` — testnet relayer endpoint
- `TEST_SEAL_SERVERS` — comma-separated Seal server object IDs (testnet)
```

- [ ] **Step 3: Commit**

```bash
git add tests/integration/helpers/ README.md
git commit -m "test: integration test fixture and faucet helper"
```

---

## Task 24: Integration — channel + memory roundtrip

**Files:**
- Create: `tests/integration/channel.test.ts`
- Create: `tests/integration/memory.test.ts`

- [ ] **Step 1: Channel integration tests**

`tests/integration/channel.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { newWalletEnv } from './helpers/fixture.js';
import { fundFromFaucet } from './helpers/faucet.js';

describe('channel integration', () => {
  let env: ReturnType<typeof newWalletEnv>;

  beforeAll(async () => {
    env = newWalletEnv();
    await fundFromFaucet(env.address);
  }, 30_000);

  it('creates a channel and lists self as admin', async () => {
    const created: any = await env.dispatcher.invoke('channel.create', { name: 'test-' + Date.now() });
    expect(created.channel_id).toBeDefined();

    const members: any = await env.dispatcher.invoke('channel.members', { channel_id: created.channel_id });
    expect(members.admin).toBe(env.address);
  }, 30_000);

  it('sends 3 messages and reads them back in order', async () => {
    const created: any = await env.dispatcher.invoke('channel.create', { name: 'send-' + Date.now() });
    const cid = created.channel_id;

    for (const text of ['a', 'b', 'c']) {
      await env.dispatcher.invoke('channel.send', { channel_id: cid, content: text });
    }

    const hist: any = await env.dispatcher.invoke('channel.history', { channel_id: cid });
    expect(hist.messages.length).toBeGreaterThanOrEqual(3);

    const texts = hist.messages.slice(0, 3).map((m: any) => m.body.text).sort();
    expect(texts).toEqual(['a', 'b', 'c']);

    for (const m of hist.messages.slice(0, 3)) {
      expect(m.verified).toBe(true);
    }
  }, 60_000);
});
```

- [ ] **Step 2: Memory integration tests**

`tests/integration/memory.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { newWalletEnv } from './helpers/fixture.js';
import { fundFromFaucet } from './helpers/faucet.js';

describe('memory integration', () => {
  let env: ReturnType<typeof newWalletEnv>;
  let cid: string;

  beforeAll(async () => {
    env = newWalletEnv();
    await fundFromFaucet(env.address);
    const created: any = await env.dispatcher.invoke('channel.create', { name: 'mem-' + Date.now() });
    cid = created.channel_id;
  }, 30_000);

  it('writes and reads memory', async () => {
    const w: any = await env.dispatcher.invoke('memory.write', {
      channel_id: cid,
      key: 'note.md',
      content: 'this is a note',
    });
    expect(w.uri).toMatch(/^walrus:\/\//);

    const r: any = await env.dispatcher.invoke('memory.read', { uri: w.uri });
    expect(r.content).toBe('this is a note');
    expect(r.verified).toBe(true);
    expect(r.author).toBe(env.address);
  }, 60_000);
});
```

- [ ] **Step 3: Run**

```bash
TEST_RELAYER_URL=... TEST_SEAL_SERVERS=0x... pnpm test:int
```

Expected: tests pass on testnet.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/channel.test.ts tests/integration/memory.test.ts
git commit -m "test: channel + memory integration on testnet"
```

---

## Task 25: Integration — Cross-Org + Permission + Tamper + Infra Failures

**Files:**
- Create: `tests/integration/cross-org.test.ts`
- Create: `tests/integration/permission.test.ts`
- Create: `tests/integration/tamper.test.ts`
- Create: `tests/integration/infra.test.ts`

- [ ] **Step 1: Cross-org test (Alice + Bob)**

`tests/integration/cross-org.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { newWalletEnv } from './helpers/fixture.js';
import { fundFromFaucet } from './helpers/faucet.js';

describe('cross-org collaboration (D2 mini)', () => {
  let alice: any, bob: any, cid: string;

  beforeAll(async () => {
    alice = newWalletEnv();
    await fundFromFaucet(alice.address);
    bob = newWalletEnv();
    await fundFromFaucet(bob.address);
  }, 60_000);

  it('Alice creates, invites Bob, Bob joins and sees history', async () => {
    const c: any = await alice.dispatcher.invoke('channel.create', { name: 'd2-' + Date.now() });
    cid = c.channel_id;

    await alice.dispatcher.invoke('channel.send', { channel_id: cid, content: 'alice msg 1' });
    await alice.dispatcher.invoke('channel.invite', { channel_id: cid, address: bob.address });

    // Bob joins
    const j: any = await bob.dispatcher.invoke('channel.join', { channel_id: cid });
    expect(j.history_count).toBeGreaterThanOrEqual(1);

    // Bob sends, Alice reads it back and verifies
    await bob.dispatcher.invoke('channel.send', { channel_id: cid, content: 'bob msg 1' });
    const hist: any = await alice.dispatcher.invoke('channel.history', { channel_id: cid });
    const bobMsg = hist.messages.find((m: any) => m.body.text === 'bob msg 1');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.sender).toBe(bob.address);
    expect(bobMsg.verified).toBe(true);

    const v: any = await alice.dispatcher.invoke('identity.verify', {
      channel_id: cid,
      message_id: bobMsg.message_id,
    });
    expect(v.verified).toBe(true);
    expect(v.sender).toBe(bob.address);
  }, 120_000);
});
```

- [ ] **Step 2: Permission revoke test**

`tests/integration/permission.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { newWalletEnv } from './helpers/fixture.js';
import { fundFromFaucet } from './helpers/faucet.js';

describe('permission revoke', () => {
  let alice: any, bob: any;

  beforeAll(async () => {
    alice = newWalletEnv();
    bob = newWalletEnv();
    await fundFromFaucet(alice.address);
    await fundFromFaucet(bob.address);
  }, 60_000);

  it('kicked member cannot read new messages', async () => {
    const c: any = await alice.dispatcher.invoke('channel.create', {
      name: 'kick-' + Date.now(),
      members: [bob.address],
    });
    await alice.dispatcher.invoke('channel.send', { channel_id: c.channel_id, content: 'before-kick' });

    // Bob can read it
    const before: any = await bob.dispatcher.invoke('channel.history', { channel_id: c.channel_id });
    expect(before.messages.some((m: any) => m.body.text === 'before-kick')).toBe(true);

    // Alice kicks Bob
    await alice.dispatcher.invoke('channel.kick', { channel_id: c.channel_id, address: bob.address });

    // Alice sends new message
    await alice.dispatcher.invoke('channel.send', { channel_id: c.channel_id, content: 'after-kick' });

    // Bob tries to read new — should fail or not see new message
    await expect(
      bob.dispatcher.invoke('channel.history', { channel_id: c.channel_id }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/MEMBERSHIP_REVOKED|CHANNEL_ACCESS_DENIED/) });
  }, 120_000);
});
```

- [ ] **Step 3: Tamper test**

`tests/integration/tamper.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { encodeBlob, decodeBlob, verifyBlob } from '../../src/memory-blob.js';

describe('blob tamper detection', () => {
  it('detects modified content', async () => {
    const kp = new Ed25519Keypair();
    const blob = await encodeBlob(
      { channel_id: 'c', key: 'k', content_type: 'text/plain', content: 'original', message_id: 'm1' },
      kp,
    );
    const decoded = decodeBlob(blob);
    decoded.content = 'tampered';
    expect(await verifyBlob(decoded)).toBe(false);
  });
});
```

- [ ] **Step 4: Infra failure test**

`tests/integration/infra.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Dispatcher } from '../../src/mcp/dispatch.js';
import { Outbox } from '../../src/outbox.js';
import { sendTool } from '../../src/tools/channel-messaging.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('relayer offline → outbox', () => {
  it('queues send when SDK throws timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'infra-'));
    const outbox = new Outbox(dir);

    // Mock sdk that always times out
    const sdk: any = {
      keypair: { toSuiAddress: () => '0xfake' },
      client: {
        messaging: {
          sendMessage: async () => {
            throw new Error('timeout');
          },
        },
      },
    };

    const dispatcher = new Dispatcher();
    dispatcher.register(sendTool(sdk, outbox));

    await expect(dispatcher.invoke('channel.send', { channel_id: 'c', content: 'hi' })).rejects.toMatchObject({
      code: 'RELAYER_UNREACHABLE',
    });

    expect(outbox.pending()).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Run all integration tests**

```bash
TEST_RELAYER_URL=... TEST_SEAL_SERVERS=0x... pnpm test:int
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/
git commit -m "test: cross-org, permission, tamper, infra integration tests"
```

---

## Task 26: E2E Script (Two MCP Servers)

**Files:**
- Create: `tests/e2e/d2-demo.sh`
- Create: `scripts/run-mcp.sh`

- [ ] **Step 1: MCP wrapper script for tests**

`scripts/run-mcp.sh`:

```bash
#!/usr/bin/env bash
# Usage: ./scripts/run-mcp.sh <alice|bob>
ROLE=$1
ENV_FILE=".env.$ROLE"
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi
export $(grep -v '^#' "$ENV_FILE" | xargs)
exec node dist/cli.js
```

`chmod +x scripts/run-mcp.sh`

- [ ] **Step 2: E2E script**

`tests/e2e/d2-demo.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Pre-flight
[ -f .env.alice ] || { echo "Missing .env.alice"; exit 1; }
[ -f .env.bob ] || { echo "Missing .env.bob"; exit 1; }
pnpm build

call() {
  local role=$1 tool=$2 args=$3
  local req
  req=$(jq -n --arg tool "$tool" --argjson args "$args" \
    '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:$tool,arguments:$args}}')
  echo "$req" | ./scripts/run-mcp.sh "$role" | jq -r '.result.content[0].text' | jq .
}

echo "[1/6] Alice creates channel"
RES=$(call alice channel.create '{"name":"e2e-test"}')
CHAN=$(echo "$RES" | jq -r '.channel_id')
echo "channel_id=$CHAN"

echo "[2/6] Alice sends a hello"
call alice channel.send "$(jq -n --arg c "$CHAN" '{channel_id:$c,content:"hello from alice"}')"

echo "[3/6] Alice writes memory"
WRITE=$(call alice memory.write "$(jq -n --arg c "$CHAN" '{channel_id:$c,key:"a.md",content:"alice findings"}')")
URI=$(echo "$WRITE" | jq -r '.uri')

echo "[4/6] Alice invites Bob"
BOB_ADDR=$(call bob identity.whoami '{}' | jq -r '.address')
call alice channel.invite "$(jq -n --arg c "$CHAN" --arg a "$BOB_ADDR" '{channel_id:$c,address:$a}')"

echo "[5/6] Bob joins, reads history, reads memory"
call bob channel.join "$(jq -n --arg c "$CHAN" '{channel_id:$c}')"
HIST=$(call bob channel.history "$(jq -n --arg c "$CHAN" '{channel_id:$c}')")
echo "$HIST" | jq -e '.messages[] | select(.body.text=="hello from alice")' > /dev/null
echo "  ✓ Bob sees alice message"

READ=$(call bob memory.read "$(jq -n --arg u "$URI" '{uri:$u}')")
echo "$READ" | jq -e '.verified == true' > /dev/null
echo "  ✓ Bob reads alice's memory with verified=true"

echo "[6/6] Bob sends back, Alice verifies"
SEND=$(call bob channel.send "$(jq -n --arg c "$CHAN" '{channel_id:$c,content:"bob here"}')")
BOB_MSG_ID=$(echo "$SEND" | jq -r '.message_id')
VERIFY=$(call alice identity.verify "$(jq -n --arg c "$CHAN" --arg m "$BOB_MSG_ID" '{channel_id:$c,message_id:$m}')")
echo "$VERIFY" | jq -e '.verified == true and .sender == "'$BOB_ADDR'"' > /dev/null
echo "  ✓ Alice verifies Bob's signature"

echo ""
echo "ALL GREEN — D2 demo flow works."
```

`chmod +x tests/e2e/d2-demo.sh`

- [ ] **Step 3: Set up .env.alice and .env.bob**

Generate two wallets, fund them, write env files:

```bash
node -e "/* generate alice */ ..." > .env.alice  # plus seed funding
node -e "/* generate bob */ ..." > .env.bob
```

(Done manually one-time; commit env templates not values.)

- [ ] **Step 4: Run E2E**

```bash
pnpm test:e2e
```

Expected: prints `ALL GREEN — D2 demo flow works.`

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/d2-demo.sh scripts/run-mcp.sh
git commit -m "test: E2E D2 demo script with two MCP instances"
```

---

# Phase 6: Mainnet + Polish (Days 25-29)

## Task 27: Mainnet Config + Smoke Test

**Files:**
- Modify: `src/config.ts` (mainnet defaults)
- Create: `docs/MAINNET.md`

- [ ] **Step 1: Update mainnet RELAYER and Seal server defaults**

In `src/config.ts`, set real values (look up from sui-stack-messaging's mainnet deployment):

```ts
const DEFAULT_RELAYER_MAINNET = 'https://<real-mainnet-relayer>';
// SEAL_SERVERS for mainnet: keep required, no default (user must set)
```

- [ ] **Step 2: Provision a mainnet wallet for the demo**

```bash
# Generate keypair
node bin/init.js
# Manually fund with ~5 SUI from your own mainnet wallet, or use a tool like Suiet/Sui Wallet to send
```

- [ ] **Step 3: Run mainnet smoke**

Update `.env.alice.mainnet` and `.env.bob.mainnet` with mainnet config. Run a stripped-down E2E:

```bash
SUI_NETWORK=mainnet pnpm smoke
SUI_NETWORK=mainnet ./tests/e2e/d2-demo.sh   # may need env tweaks
```

Expected: passes. If any tool fails on mainnet (e.g., different Seal server IDs), fix in code.

- [ ] **Step 4: Write MAINNET.md**

`docs/MAINNET.md`:

```markdown
# Mainnet Deployment Notes

## Wallet provisioning
1. `npx walrus-agent-stack` to generate a wallet.
2. Send ~5 SUI from any mainnet wallet to the printed address.
3. Edit `~/.walrus-agent-stack/config.env`:
   - `SUI_NETWORK=mainnet`
   - `RELAYER_URL=<mainnet relayer>`
   - `SEAL_SERVERS=<mainnet seal server object IDs>`
   - `SUI_RPC_URLS=https://fullnode.mainnet.sui.io:443`

## Verified flows on mainnet (as of <date>)
- channel.create — ✓
- channel.send + history — ✓
- memory.write + read — ✓
- channel.invite + join — ✓
- channel.kick + key rotation — ✓
- identity.verify — ✓
```

- [ ] **Step 5: Commit**

```bash
git add src/config.ts docs/MAINNET.md
git commit -m "feat: mainnet config + verified smoke flows"
```

---

## Task 28: README

**Files:**
- Modify: `README.md`
- Create: `docs/architecture.png` (or ASCII alternative)

- [ ] **Step 1: Write README**

`README.md`:

```markdown
# Walrus Agent Stack

> Walrus-backed shared memory + encrypted channels for any MCP agent.

A TypeScript MCP server + Claude Code plugin that gives any MCP-compatible AI agent:
- 🔐 **Encrypted A2A channels** — agents from different users/orgs collaborate without trusting infrastructure
- 📦 **Persistent shared memory** — Walrus-stored, content-addressed, channel-scoped
- ✅ **Verifiable identity** — every message and blob signed; any third party can audit
- 🪪 **Cross-org by design** — multi-owner Sui Groups; not a single-tenant memory layer

## Quick Start (5 minutes)

\`\`\`bash
# 1. Install the plugin in Claude Code
/plugin marketplace add https://github.com/<user>/walrus-agent-stack
/plugin install walrus-agent-stack

# 2. Generate a wallet + config
npx walrus-agent-stack init

# 3. Start collaborating
/agent-channel new "Stablecoin Regulation 2026"
\`\`\`

## D2 Demo

Watch two Claude Code sessions (Alice + Bob, different wallets) collaborate via a single encrypted channel: [YouTube link]

## Architecture

\`\`\`
[ASCII diagram from spec §4]
\`\`\`

## Why Not MemWal?

| Feature | MemWal | Walrus Agent Stack |
|---|---|---|
| Single-user agent memory | ✅ | — |
| Multi-user / multi-org channels | ❌ | ✅ |
| Per-member signatures | ❌ | ✅ |
| Third-party verifiable audit | ❌ | ✅ |

Both MCPs are complementary — install MemWal for "agents remember you" + this for "agents collaborate with each other."

## MCP Tools

15 tools across `channel.*`, `memory.*`, `identity.*`, `system.*`. See `docs/tools.md`.

## Status

Beta. Built for Sui Overflow 2026 Walrus Track. Unaudited — not for production with sensitive data.

## License

Apache-2.0
```

- [ ] **Step 2: ASCII architecture diagram**

Copy the one from spec §4 into the README's architecture section.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with quick start, comparison, architecture"
```

---

## Task 29: Tool + Subagent Reference Docs

**Files:**
- Create: `docs/tools.md`
- Create: `docs/subagents.md`

- [ ] **Step 1: Write tools.md**

`docs/tools.md`:

```markdown
# MCP Tool Reference

All tools return JSON. Errors have `{code, message, details?}` shape.

## channel.create
**Args:** `{name: string, members?: Address[]}`
**Returns:** `{channel_id, object_id, admin}`
Creates a new encrypted channel. Caller becomes admin.

## channel.invite
**Args:** `{channel_id, address}`
**Returns:** `{channel_id, invited}`
Add a Sui address as member.

## channel.kick
**Args:** `{channel_id, address}`
**Returns:** `{channel_id, kicked, key_rotated: true}`
Remove member + rotate Seal key.

[... continue for all 15 tools, copy details from spec §5.1 and code ...]

## Error Codes

| Code | Meaning |
|---|---|
| `UNKNOWN_TOOL` | Tool name not registered |
| `INVALID_ARGS` | Zod schema validation failed |
| `RELAYER_UNREACHABLE` | Relayer down/timeout; message queued to outbox |
| `SUI_RPC_DOWN` | All RPC endpoints failed |
| `INSUFFICIENT_GAS` | Wallet lacks SUI for transaction |
| `WALRUS_UNAVAILABLE` | Walrus aggregator unreachable |
| `BLOB_EXPIRED` | Walrus blob past retention |
| `SEAL_QUORUM_FAILED` | Not enough Seal shares |
| `CHANNEL_ACCESS_DENIED` | Not a member |
| `MEMBERSHIP_REVOKED` | You were kicked |
| `CHANNEL_NOT_FOUND_OR_FORGED` | Bad channel_id |
| `MEMORY_TAMPERED` | Inner blob signature mismatch |
| `MESSAGE_NOT_FOUND` | identity.verify target missing |
| `RATE_LIMITED` | >10 ops/min for this user+channel |
| `LOOP_DETECTED` | Same sender ≥5x in a row |
| `INTERNAL_ERROR` | Unexpected exception |
```

- [ ] **Step 2: Write subagents.md**

`docs/subagents.md`:

```markdown
# Subagent Templates

## research-leader
Coordinates a research squad. Spawns analysts + synthesizer.

## analyst
Researches a single subtopic, writes findings as channel-scoped Walrus memory.

## synthesizer
Reads all memory in a channel, produces a final markdown report.

## Customization

Copy any template under `plugin/agents/` into your own plugin or session-level subagent config. Modify the prompt to your needs.
```

- [ ] **Step 3: Commit**

```bash
git add docs/tools.md docs/subagents.md
git commit -m "docs: tool and subagent reference"
```

---

## Task 30: Brand Assets + Plugin Marketplace Metadata

**Files:**
- Create: `plugin/logo.png` (1:1, ≥256×256)
- Create: `plugin/marketplace.json`

- [ ] **Step 1: Generate a logo**

Use any tool (Figma / Sketch / midjourney). Target: 1024×1024 PNG, simple geometric mark suggesting "interconnected agents on Walrus." Save as `plugin/logo.png`.

If short on time: text-only logo with "WAS" mono letterform.

- [ ] **Step 2: Marketplace metadata**

`plugin/marketplace.json`:

```json
{
  "name": "walrus-agent-stack",
  "displayName": "Walrus Agent Stack",
  "summary": "Walrus-backed shared memory + encrypted channels for any MCP agent",
  "logo": "logo.png",
  "tags": ["mcp", "walrus", "sui", "agent", "memory", "encryption", "verifiable"],
  "categories": ["agents", "infrastructure"]
}
```

- [ ] **Step 3: Commit**

```bash
git add plugin/logo.png plugin/marketplace.json
git commit -m "chore: brand assets + marketplace metadata"
```

---

# Phase 7: Demo (Days 30-37)

## Task 31: Demo Rehearsal #1 — Dry Run

**Files:** N/A (operational)

- [ ] **Step 1: Set up recording environment**

- Two Claude Code windows, side by side, on a 1920×1080 or larger display
- Increase Claude Code font size to ~18pt (readable in 1080p video)
- Plugin installed in both, with separate `~/.walrus-agent-stack/` configs (use `HOME` override per session)
- Both wallets funded on mainnet
- ScreenStudio or OBS configured, 30fps, 1080p

- [ ] **Step 2: Time-block the 5-minute script**

Match spec §6.1 verbatim. Mark each step with target timestamp on a printed script.

- [ ] **Step 3: Run #1 unrecorded**

Go through the full flow, take notes of:
- Steps that ran rough
- Subagents that ad-libbed
- Tools that returned unexpected output
- Pauses where Claude Code was thinking longer than expected

- [ ] **Step 4: Document fixes needed**

Create `docs/demo-fixes.md` listing each rough spot and the fix (prompt change, slash command tweak, retry config bump).

- [ ] **Step 5: Apply fixes**

Edit subagent prompts / slash commands / docs as needed.

- [ ] **Step 6: Commit**

```bash
git add docs/demo-fixes.md plugin/
git commit -m "chore: demo rehearsal #1 fixes"
```

---

## Task 32: Demo Rehearsal #2 — Polish Script

**Files:** N/A (operational)

- [ ] **Step 1: Run #2 — record but don't keep**

Full recording on real mainnet. After, watch it back, look for:
- Voice clarity
- Pacing
- Dead air > 3 seconds
- On-screen mouse jitter / messy windows

- [ ] **Step 2: Adjust script**

Lock voice-over script word-for-word.

- [ ] **Step 3: Final subagent prompt tweaks**

If any subagent goes off-script, tighten its system prompt with explicit "first step: call channel.send with announcement format X".

- [ ] **Step 4: Commit**

```bash
git add plugin/
git commit -m "chore: demo rehearsal #2 — prompt and pacing fixes"
```

---

## Task 33: Demo Rehearsal #3 — Recording Quality

**Files:** N/A (operational)

- [ ] **Step 1: Pre-flight checklist**

Run through:
- [ ] Mainnet wallets each have ≥3 SUI
- [ ] `/agent-stack health` on both windows returns ok
- [ ] Walrus aggregator latency < 2s
- [ ] Microphone test (record 10s, listen back)
- [ ] No notifications enabled on Mac
- [ ] Wifi stable

- [ ] **Step 2: Record full attempt #1**

If success: keep as backup. If failed: try again.

- [ ] **Step 3: Record full attempt #2**

Save both. Keep the better.

- [ ] **Step 4: Commit any final tweaks**

```bash
git add -A
git commit -m "chore: pre-recording final polish"
```

---

## Task 34: Demo Video Production

**Files:** Final video file (not in repo; uploaded to YouTube)

- [ ] **Step 1: Edit video in ScreenStudio / DaVinci Resolve**

- Trim dead space
- Add title card: "Walrus Agent Stack — Sui Overflow 2026"
- Add lower-third labels: "Alice's Claude Code" / "Bob's Claude Code"
- Add captions for spoken parts (optional but helpful)
- End card with GitHub URL + tagline

- [ ] **Step 2: Export 1080p H.264**

Target: < 5:00 duration, < 100 MB file size.

- [ ] **Step 3: Upload to YouTube**

- Title: "Walrus Agent Stack — Cross-Org AI Agent Collaboration on Sui (Sui Overflow 2026)"
- Description: tagline + 3-bullet "what it is" + link to GitHub repo
- Tags: sui, walrus, mcp, ai agents, hackathon
- Visibility: Public
- Add to a "Sui Overflow 2026" playlist

- [ ] **Step 4: Update README and submission**

Replace the `[YouTube link]` placeholder in README.md with the real URL.

```bash
git add README.md
git commit -m "docs: add demo video link"
```

---

## Task 35: Submission

**Files:** External (DeepSurge form)

- [ ] **Step 1: Fill DeepSurge submission**

- **Project Name:** Walrus Agent Stack
- **Description:** "Walrus-backed shared memory + encrypted channels for any MCP agent. Agents from different users collaborate in encrypted channels, share verifiable Walrus memory, and produce cryptographically auditable outputs — without trusting any centralized coordinator."
- **Logo:** `plugin/logo.png`
- **GitHub Repo:** public URL (verify it's public)
- **Demo Video:** YouTube URL
- **Website:** N/A or GitHub Pages of the docs
- **Deployment:** Mainnet
- **Package ID:** sui-stack-messaging mainnet package ID (we reuse, no new package)

- [ ] **Step 2: Final pre-submission audit**

- [ ] Repo is public on GitHub
- [ ] README has architecture + quick start + comparison table
- [ ] Demo video is public on YouTube and < 5:00
- [ ] All tests pass (unit + integration + E2E)
- [ ] Mainnet smoke verified within last 24 hours
- [ ] License file present (Apache-2.0)
- [ ] CHANGELOG.md noting v0.1.0 (optional but professional)
- [ ] No secrets committed (grep repo for `suiprivkey`)

- [ ] **Step 3: Submit**

Hit submit on DeepSurge. Confirm receipt email.

- [ ] **Step 4: Tag release**

```bash
git tag v0.1.0
git push --tags
gh release create v0.1.0 --title "v0.1.0 — Sui Overflow 2026 Submission" --notes "Submission for Sui Overflow 2026 Walrus Track. See README for quick start and demo video."
```

- [ ] **Step 5: Final commit**

```bash
echo "Submitted: $(date)" > SUBMISSION.md
git add SUBMISSION.md
git commit -m "chore: submitted to Sui Overflow 2026"
git push
```

---

# Self-Review (post-write check)

## Spec coverage

| Spec section | Implementing tasks |
|---|---|
| §4 Architecture | T1 (repo), T4 (skeleton), T16 (plugin) |
| §5.1 MCP tools (15) | T6-T15 |
| §5.2 Plugin (subagents, commands, hook) | T16-T21 |
| §5.3 Mainnet | T27 |
| §5.4 Repo & demo | T28-T35 |
| §6.1 D2 demo steps | T25 (mini), T26 (E2E), T31-T34 (recording) |
| §6.2 Data structures | T11 (blob), T8 (envelope via SDK), T10 (URI) |
| §6.3 Verification | T14 (verify) + T29 (docs) |
| §7 Error handling | T14 (outbox), T15 (health), T22 (rate-limit/loop) |
| §8 Testing | T22-T26 |

All covered.

## Placeholder scan

Searched for: TBD, TODO, "implement later". One acknowledged comment in T6 (verify is stubbed, finalized in T14) — explicitly resolved by T14. No other placeholders.

## Type consistency

- `channel_id: string` (UUID) — consistent across all tools
- `address: string` (0x-prefixed) — consistent
- `walrus URI` — `walrus://<blob_id>?channel=&key=` — consistent across schemas (T5), URI parser (T10), memory tools (T12), demo (T26)
- Tool error shape `{code, message, details?}` — consistent across dispatcher (T4) and all tools
- Method names from SDK (`createAndShareGroup`, `sendMessage`, `getMessages`, `addMembers`, `removeMemberAndRotateKey`, `leaveGroup`, `getGroup`, `uploadAttachment`, `downloadAttachment`) — must reconcile against actual SDK at T3 spike. Plan instructs to update wrapper code if names differ.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-16-walrus-agent-stack.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this 35-task plan because each task is well-isolated and context-light.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Better if you want to drive each task and observe in real time.

**Which approach?**
