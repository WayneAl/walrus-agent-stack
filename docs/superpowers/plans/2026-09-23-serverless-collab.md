# Serverless collaboration — implementation plan

Spec: [`../specs/2026-09-23-serverless-collab-design.md`](../specs/2026-09-23-serverless-collab-design.md)

Executed in the main repo on `main` (user preference: no branch for this). Each task ends
with `pnpm typecheck && pnpm test` green and one commit.

## T1 — Move package `move/channel_log` (main session)

Build, unit-test, publish on **testnet**; record `packageId` + `registryId` in
`src/config.ts` as `CHANNEL_LOG_TESTNET = { packageId, registryId }` and in
`move/channel_log/Published.toml`.

## T2 — `SuiWalrusTransport` (subagent, new files only)

File `src/transport/sui-walrus-transport.ts` (+ `tests/unit/sui-walrus-transport.test.ts`).
Implements `RelayerTransport` from `@mysten/sui-stack-messaging`:

```ts
export interface SuiWalrusTransportOptions {
  grpc: SuiGrpcClient;                 // @mysten/sui/grpc — no JSON-RPC client
  packageId: string; registryId: string;
  walrus: { publisherUrl: string; aggregatorUrl: string; epochs: number };
  pollIntervalMs?: number;             // subscribe polling, default 3000
  fetchImpl?: typeof fetch;            // test seam
}
export class SuiWalrusTransport implements RelayerTransport { … }
```

- Log address: `deriveObjectID(registryId, '0x2::object::ID', bcs(groupId))`.
- `sendMessage`: envelope JSON `{v:1, groupId, senderAddress, encryptedText(b64), nonce(b64),
  keyVersion(string), attachments, signature, publicKey, createdAt}` → Walrus `PUT
  /v1/blobs?epochs=N` → blob id → PTB: if log object missing `new_log` + `post` +
  `share_log`, else `post`; on `new_log` abort (race) retry once with `post`. Execute,
  wait for the tx, read `order` from the `Posted` event. Return `{messageId: String(order)}`.
  Move abort `ENotSender` → `RelayerTransportError(403, 'NOT_GROUP_MEMBER')`; insufficient
  gas → `RelayerTransportError(402, 'INSUFFICIENT_GAS')`.
- `fetchMessages({groupId, afterOrder, beforeOrder, limit})`: missing log → empty. Read
  entries (TableVec dynamic fields keyed by u64) in the order window, download blobs from
  aggregator `GET /v1/blobs/<id>`, drop any whose envelope `senderAddress` ≠ entry sender
  or `groupId` mismatches. `hasNext` per window.
- `fetchMessage({messageId})` = one entry. `subscribe` = poll length every interval,
  honor `signal`. `updateMessage`/`deleteMessage` → `RelayerTransportError(405)`.
- `publicKey` = hex of `signer.getPublicKey().toSuiBytes()`.

Tests: fake grpc + fake fetch; envelope round-trip, sender-mismatch drop, windowing,
first-post PTB shape vs later-post PTB shape.

## T3 — MCP surface (subagent, parallel with T2; codes against the T2 interface)

- `src/config.ts`: read `~/.walrus-agent-stack/config.env` (`WAS_HOME` overrides the dir),
  env wins; no key → generate, write 0600, return. `RELAYER_URL` optional; absent →
  serverless transport. `WALRUS_STORAGE_EPOCHS` default 30. Seal default = the two
  Mysten testnet servers.
- `src/session.ts`: `{active_channel_id, cursors: {[channel]: order}}` in `session.json`.
- `src/sdk-client.ts`: pick transport; `resetSdk()`.
- Tools renamed `_`; dispatcher maps `.`→`_` on invoke; `server.ts` exposes
  `z.toJSONSchema(schema)` as `inputSchema`; `channel_id` optional → active channel,
  `NO_ACTIVE_CHANNEL` error otherwise.
- `channel_create`: no `initialMembers`; invite each member with full perms; sets active.
- `channel_join`: sets active; returns recent history summary.
- `channel_wait({channel_id?, timeout_s=45 (max 50), include_own=false})`: poll every 3 s
  from the stored cursor; return new messages (same shape as history) and advance cursor.
- `channel_send` args gain `to?`, `intent?`; envelope carries them; history returns them.
- `system_setup`: address, network, balance; if balance < 0.05 SUI on testnet, call the
  faucet (v2 → v1 fallback) and report; include `https://faucet.sui.io/?address=<addr>`.
- `system_health`: rpc + walrus aggregator + seal probe (no relayer when serverless).
- Remove `bin/init.js` behaviour duplication: `walrus-agent-stack init` just calls the
  same config bootstrap and prints the address.

## T4 — Plugin + packaging + docs (subagent, after T2+T3)

- `scripts/bundle.mjs` (esbuild) → `plugin/server/index.mjs` (committed); `pnpm bundle`.
- `plugin/.mcp.json` → `node ${CLAUDE_PLUGIN_ROOT}/server/index.mjs`, no env block.
- Commands: `/agent-stack setup|health|debug|resend`, `/agent-channel
  new|invite|join|members|kick|leave|listen|ask|send|history`; agents updated to `_` names.
- `listen` prompt: loop contract + security rules from the spec.
- Unregister Stop hook in `plugin/.claude-plugin/plugin.json` (file kept).
- README quick start rewritten for the two-machine flow; docs/tools.md updated;
  TESTNET.md relayer sections replaced by the serverless note.

## T5 — End-to-end (main session)

1. MCP-level: two `WAS_HOME`s, two server processes, create → invite → join → send → wait
   → memory write/read → verify, on testnet.
2. Agent-level: two headless `claude -p --plugin-dir plugin` sessions with separate
   `WAS_HOME`; B runs `listen`, A runs `ask`; A receives B's answer.
3. Plugin install path: `claude plugin marketplace add <repo path>` + install succeeds and
   the MCP server lists tools.
