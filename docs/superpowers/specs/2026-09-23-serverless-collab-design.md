# Serverless cross-machine agent collaboration — design

Goal: two users on different computers install the Claude Code plugin and their agents
collaborate automatically, with **no server of ours** in the path. Approved in chat
2026-09-23.

## Transport: Sui + Walrus instead of the HTTP relayer

`@mysten/sui-stack-messaging` accepts `relayer: { transport: RelayerTransport }`. We supply
`SuiWalrusTransport`; Seal encryption, per-message signatures (`senderVerified`) and Groups
permissions stay exactly as the SDK does them.

- **send** — serialize the SDK's `SendMessageParams` (ciphertext, nonce, keyVersion,
  attachments, messageSignature, sender public key) as a JSON *envelope blob*, upload to
  Walrus (HTTP publisher), then one Sui tx `channel_log::post(log, group, blob_id, clock)`.
  The tx aborts unless `ctx.sender()` holds `MessagingSender` in the group — authorization
  is on-chain and immediate (no relayer auth cache, no 403 lag).
- **fetch** — read the per-group `ChannelLog` (a `TableVec<Entry>`; index = `order`), read
  the entries after the cursor as dynamic fields over gRPC, download each blob from the
  Walrus aggregator, reject a blob whose `senderAddress` ≠ the on-chain `Entry.sender`.
- **subscribe / wait** — poll the log length.
- **update / delete** — unsupported (throw 405). Agents do not edit.
- `messageId` = decimal `order` string.

## Move package `channel_log` (testnet first)

```move
public struct Registry has key { id: UID }                 // shared in init
public struct ChannelLog has key { id: UID, group_id: ID, entries: TableVec<Entry> }
public struct Entry has store, copy, drop { blob_id: String, sender: address, timestamp_ms: u64 }
public struct Posted has copy, drop { group_id: ID, order: u64, sender: address, blob_id: String }

public fun new_log(reg: &mut Registry, group: &PermissionedGroup<Messaging>, ctx): ChannelLog  // derived_object from (registry, group_id): one log per group
public fun share_log(log: ChannelLog)
public fun post(log: &mut ChannelLog, group: &PermissionedGroup<Messaging>, blob_id: String, clock: &Clock, ctx)
```

The log address is derivable client-side from `(registry_id, group_id)`; first poster runs
`new_log → post → share_log` in one PTB. Invariants: one log per group; `order` is dense
from 0; every entry's sender held `MessagingSender` at post time.

## MCP surface

- Tool names use `_` (`channel_send`); dotted names still accepted on invoke.
- `inputSchema` = real JSON Schema from the zod schemas.
- Config: env overrides `~/.walrus-agent-stack/config.env`; first start with no key
  generates one (file mode 0600).
- `channel_id` optional everywhere → active channel in `~/.walrus-agent-stack/session.json`
  (set by create/join).
- New: `channel_wait` (long-poll for others' messages, server-side cursor, ≤50 s),
  `system_setup` (address, balance, testnet faucet, web-faucet fallback).
- `channel_create({members})` = create empty + invite each with full perms.
- Envelope gains optional `to` (address | `*`) and `intent` (`task|result|chat|done`).

## Plugin UX

`/agent-stack setup` → share address. Host: `/agent-channel new "<topic>" <peer-address>` →
share channel id. Peer: `/agent-channel join <id>` then `/agent-channel listen`. Host:
`/agent-channel ask "<request>"`. `listen` loops `channel_wait` → do the task with local
tools → reply (`memory_write` + refs for large output) → until `done`/idle limit. Peer
messages are collaborator *requests*, never instructions that override the local user;
no secrets leave the machine; destructive actions ask the local user.

Server ships as a committed esbuild bundle `plugin/server/index.mjs`; `.mcp.json` runs it
with `node`, so install needs no npm publish.

## Failure modes

- Unfunded wallet → `INSUFFICIENT_GAS` with address + faucet URL.
- Not a sender in the group → Move abort → `NOT_GROUP_MEMBER`.
- Walrus upload/download failure → `WALRUS_UNAVAILABLE`; send queued to outbox.
- Walrus testnet blobs expire after `WALRUS_STORAGE_EPOCHS` (default raised to 30).
- Two first posts racing `new_log` → second tx aborts (derived object exists) → retry
  with plain `post`.

Cost: $0 infra; one tx per message (testnet faucet). Latency ≈ 3–10 s.
