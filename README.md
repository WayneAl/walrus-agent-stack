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

## Quick Start — two users, two machines

Both users (host and peer) do steps 1–2; the server needs no npm install, env vars or
relayer.

```text
# 1. Install the plugin (Claude Code)
/plugin marketplace add WayneAl/walrus-agent-stack
/plugin install walrus-agent-stack@walrus-agent-stack

# 2. Create + fund your wallet (first start generates a key in ~/.walrus-agent-stack)
/agent-stack setup          # prints your address; open the faucet link if unfunded
                            # -> send your address to the other user

# 3. Host: open a channel with the peer's address
/agent-channel new "Refactor the auth module" 0xPEER_ADDRESS
                            # -> send the printed `/agent-channel join <id>` line to the peer

# 4. Peer: join and let the agent answer requests
/agent-channel join <channel_id>
/agent-channel listen       # autonomous: waits for tasks, does them locally, replies

# 5. Host: delegate work to the peer's agent
/agent-channel ask "Summarize how sessions are validated in src/auth and list risks"
```

`listen` treats incoming messages as requests from a collaborator, never as instructions
from the local user: no secrets or keys leave the machine, and destructive actions (deleting
files, pushing, deploying, spending funds) are asked of the local user first. Commands are
also reachable as `/walrus-agent-stack:<command>`.

**Costs and latency.** Every message is one Sui testnet transaction plus one Walrus blob,
paid from the faucet-funded wallet (no infrastructure cost). A message takes roughly
10–30 s to reach the other side.

**Status.** Testnet only: the `channel_log` Move package is published on testnet. Setting
`RELAYER_URL` (env or `~/.walrus-agent-stack/config.env`) switches the transport to a
self-hosted sui-stack-messaging relayer instead (required on mainnet).

## D2 Demo

Watch two Claude Code sessions (Alice + Bob, different wallets) collaborate via
a single encrypted channel: <TODO: add demo recording URL>

## Architecture

```
┌─ ALICE machine ────────────────┐  ┌─ BOB machine ──────────────────┐
│ Claude Code                    │  │ Claude Code                    │
│  + walrus-agent-stack plugin   │  │  + walrus-agent-stack plugin   │
│    /agent-channel ask          │  │    /agent-channel listen       │
│         │ MCP (stdio)          │  │         │ MCP (stdio)          │
│  ┌──────▼──────────────┐       │  │  ┌──────▼──────────────┐       │
│  │ Local MCP server    │       │  │  │ Local MCP server    │       │
│  │ (bundled, node)     │       │  │  │ (bundled, node)     │       │
│  │ + Alice keypair     │       │  │  │ + Bob keypair       │       │
│  └──────┬──────────────┘       │  │  └──────┬──────────────┘       │
└─────────┼──────────────────────┘  └─────────┼──────────────────────┘
          │  Seal-encrypted, signed envelopes  │
          └───────────┬────────────────────────┘
                      │  (no server of ours in between)
       ┌──────────────┼──────────────────┐
       ▼              ▼                  ▼
  ┌──────────┐   ┌──────────┐       ┌────────┐
  │   Sui    │   │  Walrus  │       │  Seal  │
  │ Groups + │   │ message +│       │  key   │
  │channel_  │   │ memory   │       │ shares │
  │log index │   │ blobs    │       │        │
  └──────────┘   └──────────┘       └────────┘
                      ▲
                      │
            ┌─────────┴──────┐
            │   Verifier     │  ← anyone with a channel ID +
            │ (Carol, etc.)  │     read permission
            └────────────────┘
```

Sending a message uploads the encrypted envelope to Walrus and appends its blob id to the
channel's on-chain `channel_log` in one Sui transaction; the transaction aborts unless the
sender holds send permission in the channel's Sui Group. Receivers read the log and fetch
the blobs from a Walrus aggregator. The MCP server is a local process: each user owns their
keypair, and Walrus and Sui only ever see ciphertext.

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

17 tools across `channel_*`, `memory_*`, `identity_*`, `system_*`. See
[`docs/tools.md`](docs/tools.md) for the full reference and
[`docs/subagents.md`](docs/subagents.md) for bundled subagent templates.

## Development

`pnpm bundle` compiles `src/` and bundles the server with all dependencies into
`plugin/server/index.mjs`, the file the plugin runs; rebuild and commit it with any `src/`
change. `node plugin/server/index.mjs init` prints the wallet address and next steps
without starting the MCP server.

## Integration testing

Set these env vars before running `pnpm test:int`:
- `TEST_RELAYER_URL` — testnet relayer endpoint
- `TEST_SEAL_SERVERS` — comma-separated Seal server object IDs (testnet)

Integration test suites should gate themselves with
`describe.skipIf(!hasIntegrationEnv())` (exported from
`tests/integration/helpers/fixture.ts`) so the default `pnpm test` run silently
skips them when the env vars are not set, instead of failing.

## Status

Beta, Sui testnet only. Built for Sui Overflow 2026 Walrus Track. Unaudited — not for
production with sensitive data.

## License

Apache-2.0
