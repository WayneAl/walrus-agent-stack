# Walrus Agent Stack

> Walrus-backed shared memory and encrypted channels for any MCP agent.

A TypeScript MCP server + Claude Code plugin that gives any MCP-compatible AI
agent:

- Encrypted A2A channels — agents from different users/orgs collaborate without
  trusting infrastructure
- Persistent shared memory — Walrus-stored, content-addressed, channel-scoped
- Verifiable identity — every message and blob is signed; any third party can
  audit
- Cross-org by design — multi-owner Sui Groups; not a single-tenant memory layer

## Quick Start (5 minutes)

```bash
# 1. Install the plugin in Claude Code
/plugin marketplace add https://github.com/WayneAl/walrus-agent-stack
/plugin install walrus-agent-stack

# 2. Generate a wallet + config
npx walrus-agent-stack init

# 3. Start collaborating
/agent-channel new "Stablecoin Regulation 2026"
```

## D2 Demo

Watch two Claude Code sessions (Alice + Bob, different wallets) collaborate via
a single encrypted channel: <TODO: add demo recording URL>

## Architecture

```
┌─ ALICE side ───────────────────┐  ┌─ BOB side ─────────────────────┐
│ Claude Code                    │  │ Claude Code                    │
│  + agent-stack plugin          │  │  + agent-stack plugin          │
│  + 3 subagents                 │  │  + 3 subagents                 │
│  + /channel-* slash commands   │  │  + /channel-* slash commands   │
│         │ MCP (stdio)          │  │         │ MCP (stdio)          │
│  ┌──────▼──────────────┐       │  │  ┌──────▼──────────────┐       │
│  │ Local MCP server    │       │  │  │ Local MCP server    │       │
│  │  (TS, npx-launched) │       │  │  │                     │       │
│  │  + Alice keypair    │       │  │  │  + Bob keypair      │       │
│  └──────┬──────────────┘       │  │  └──────┬──────────────┘       │
└─────────┼──────────────────────┘  └─────────┼──────────────────────┘
          │                                    │
          └───────────┬────────────────────────┘
                      │ HTTPS (E2E ciphertext only)
              ┌───────▼────────┐
              │ Public Relayer │ ← reuse sui-stack-messaging
              │                │   existing relayer template
              └───────┬────────┘
                      │
       ┌──────────────┼─────────────┐
       ▼              ▼             ▼
  ┌────────┐     ┌────────┐    ┌────────┐
  │  Sui   │     │ Walrus │    │  Seal  │
  │ Groups │     │ blobs  │    │ key    │
  │ + sigs │     │(memory)│    │ shares │
  └────────┘     └────────┘    └────────┘
                      ▲
                      │
            ┌─────────┴──────┐
            │   Verifier     │  ← anyone with a channel ID +
            │ (Carol, etc.)  │     read permission
            └────────────────┘
```

The MCP server is a local process — the user owns the keypair, data is not
locked into a single platform. The relayer only sees end-to-end ciphertext; it
cannot decrypt messages or memory blobs.

## Why Not MemWal?

| Feature                              | MemWal | Walrus Agent Stack |
| ------------------------------------ | :----: | :----------------: |
| Single-user agent memory             |   ✓    |         —          |
| Multi-user / multi-org channels      |   —    |         ✓          |
| Per-member signatures                |   —    |         ✓          |
| Third-party verifiable audit         |   —    |         ✓          |
| Key rotation on member removal       |   —    |         ✓          |

Both MCPs are complementary — install MemWal for "agents remember you" plus
this stack for "agents collaborate with each other."

## MCP Tools

15 tools across `channel.*`, `memory.*`, `identity.*`, `system.*`. See
[`docs/tools.md`](docs/tools.md) for the full reference and
[`docs/subagents.md`](docs/subagents.md) for bundled subagent templates.

## Integration testing

Set these env vars before running `pnpm test:int`:
- `TEST_RELAYER_URL` — testnet relayer endpoint
- `TEST_SEAL_SERVERS` — comma-separated Seal server object IDs (testnet)

Integration test suites should gate themselves with
`describe.skipIf(!hasIntegrationEnv())` (exported from
`tests/integration/helpers/fixture.ts`) so the default `pnpm test` run silently
skips them when the env vars are not set, instead of failing.

## Status

Beta. Built for Sui Overflow 2026 Walrus Track. Unaudited — not for production
with sensitive data.

## License

Apache-2.0
