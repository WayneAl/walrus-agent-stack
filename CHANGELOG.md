# Changelog

All notable changes to Walrus Agent Stack are documented here.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/),
with version numbers following [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-05-17

Initial release for Sui Overflow 2026 Walrus Track.

### Added

- **MCP server (TypeScript, stdio transport)** exposing 15 tools across four families:
  - `identity.*` — `whoami`, `verify`
  - `channel.*` — `create`, `members`, `invite`, `kick`, `leave`, `send`, `history`, `join`
  - `memory.*` — `write`, `read`
  - `system.*` — `health`, `debug`, `resend`
- **Wraps `@mysten/sui-stack-messaging@0.0.2`** via the `createSuiStackMessagingClient`
  factory + a `SuiGrpcClient` (gRPC-Web on `https://fullnode.<network>.sui.io:443`).
  Auto-detects the testnet / mainnet messaging package via the SDK's exported
  `PACKAGE_CONFIG` constants.
- **Memory blob envelope** (`src/memory-blob.ts`) — author-signed JSON wrappers
  around Walrus-stored content, with `encodeBlob` / `decodeBlob` / `verifyBlob`
  using `Ed25519Keypair.signPersonalMessage` and `verifyPersonalMessageSignature`.
- **`walrus://<id>?channel=&key=` URI scheme** + parser/builder utility
  (`src/walrus-uri.ts`).
- **Tool call observability**: append-only JSONL log via `ToolLog`
  (`src/logging.ts`) wired into the `Dispatcher`; surfaced through `system.debug`.
- **Outbox + retry**: transient relayer failures classified by `isInfraError`
  enqueue to an on-disk JSON outbox (`src/outbox.ts`); `system.resend` replays.
- **Rate limit + loop detection** (`src/rate-limiter.ts`, `src/loop-detector.ts`)
  applied to `channel.send` (10/min/channel/sender, ≥5-in-a-row sender break).
- **Claude Code plugin** (`plugin/`) bundling:
  - `plugin.json` + `mcp-servers.json` for one-line install
  - Four slash command families: `/agent-channel`, `/agent-memory`,
    `/agent-verify`, `/agent-stack`
  - Three subagent templates: `research-leader`, `analyst`, `synthesizer`
  - Stop hook (`plugin/hooks/stop.sh`) for session-end archival
  - Marketplace metadata + hand-authored SVG logo
- **`npx walrus-agent-stack` init command** (`bin/init.js`) — generates a fresh
  Ed25519 keypair, hits the testnet faucet (v2 → v1 fallback), writes
  `~/.walrus-agent-stack/config.env` with sensible defaults.
- **Test suite**: 73 unit tests across `Dispatcher`, schemas, config, identity,
  channel lifecycle / messaging / subscribe, memory tools + blob envelope,
  Walrus URI, logging, outbox, system tools, rate limiter, loop detector,
  tamper detection, infra fallback. Plus 5 integration tests gated on
  `TEST_RELAYER_URL` / `TEST_SEAL_SERVERS` env.
- **End-to-end demo runners**: `tests/e2e/d2-demo.sh` (manual stdio aid),
  `tests/e2e/d2-demo.mjs` (programmatic via `@modelcontextprotocol/sdk` Client).
- **Documentation**: `README.md` (architecture, quick start, MemWal comparison),
  `docs/tools.md` (full tool reference), `docs/subagents.md`, `docs/sdk-notes.md`
  (real SDK surface vs. plan reconciliation), `docs/MAINNET.md` (deployment
  notes; mainnet verification pending).

### Known limitations

- No public hosted sui-stack-messaging relayer exists — operators must run the
  reference relayer locally (or use a private hosted instance) for any
  message-send / history flow to work end-to-end. Seal-only operations
  (e.g., `generateGroupDEK`) work without a relayer.
- Mainnet Seal key-server object IDs are not yet hardcoded — `@mysten/seal`
  removed `getAllowlistedKeyServers`; users must look up the current set from
  Seal documentation and supply `SEAL_SERVERS=<id1>,<id2>` themselves.
- `identity.verify` returns `senderVerified` from the SDK's cryptographic
  check; it does not expose a separate signature/payload-hash artifact.
- Memory blobs travel through `sendMessage`'s message stream rather than a
  direct Walrus blob upload — addressing is by parent `messageId` rather than
  Walrus storage ID. This will be revisited if/when a direct blob store API
  lands on the messaging client.
