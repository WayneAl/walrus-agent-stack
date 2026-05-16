# sui-stack-messaging v0.0.2 — SDK integration notes

These notes capture the **real** SDK shape as discovered during the T3 spike. The
plan document (`docs/superpowers/plans/2026-05-16-walrus-agent-stack.md` lines 349–482)
was written before v0.0.2 shipped and its code snippets are stale. Use this file
as the source of truth when wiring up the SDK elsewhere in the codebase.

## What the plan got wrong vs. what shipped

| Plan assumption | Reality in `@mysten/sui-stack-messaging@0.0.2` |
| --- | --- |
| `new SuiStackMessagingClient({...})` direct constructor | Use `createSuiStackMessagingClient(baseClient, options)` factory; it composes three extensions (`suiGroups`, `seal`, `suiStackMessaging`) onto an existing Sui client. |
| Pass `keypair` as `signer` once at construction time | `signer` is per-call (every messaging method takes `signer: Signer`). Only `encryption.sessionKey.signer` is set at construction. |
| `client.sendMessage(...)`, `client.getMessages(...)` | Methods live on the `messaging` extension: `client.messaging.sendMessage(...)`, `client.messaging.getMessages(...)`. |
| Seal `serverConfigs` shape unspecified | `serverConfigs: Array<{ objectId: string, weight: number }>` (weights are per-server quorum weights). |
| `packageConfig` must be supplied | **Auto-detected** for testnet/mainnet. Only required for localnet/devnet. |
| `@mysten/seal` not needed | Not a direct dep, but `@mysten/seal` and `@mysten/sui-groups` are **peer dependencies** — they must be installed for the factory to run. Both are now in `package.json`. |
| `SuiClient` from `@mysten/sui/client` works | Use **`SuiGrpcClient` from `@mysten/sui/grpc`** (JSON-RPC client is being deprecated). The factory accepts any `ClientWithCoreApi`; gRPC is the supported path forward. Constructor requires both `network` and `baseUrl`: Sui fullnodes serve gRPC-Web on the same `https://fullnode.<network>.sui.io:443` endpoint as JSON-RPC. |

## Factory signature (real)

```ts
import { SuiGrpcClient } from '@mysten/sui/grpc';
import {
  createSuiStackMessagingClient,
  WalrusHttpStorageAdapter,
} from '@mysten/sui-stack-messaging';

// gRPC: both `network` (for SDK auto-detection) and `baseUrl` (for the gRPC-Web
// transport) are required. Sui fullnodes serve both protocols on the same port.
const sui = new SuiGrpcClient({
  network: 'testnet',
  baseUrl: 'https://fullnode.testnet.sui.io:443',
});

const client = createSuiStackMessagingClient(sui, {
  seal: {
    serverConfigs: [
      { objectId: '0x73d0...db75', weight: 1 },
      { objectId: '0xf5d1...23c8', weight: 1 },
    ],
  },
  encryption: {
    sessionKey: { signer: keypair, ttlMin: 10 },
    // optional: sealThreshold, cryptoPrimitives, sealPolicy
  },
  // packageConfig: undefined  ← auto-detected for testnet/mainnet
  relayer: { relayerUrl: 'http://localhost:3000' },
  attachments: {
    storageAdapter: new WalrusHttpStorageAdapter({
      publisherUrl: 'https://publisher.walrus-testnet.walrus.space',
      aggregatorUrl: 'https://aggregator.walrus-testnet.walrus.space',
      epochs: 1,
    }),
    maxAttachments: 5,
    maxFileSizeBytes: 5 * 1024 * 1024,
  },
});

// Returned object: ClientWithExtensions<{ messaging, groups, seal }, ClientWithCoreApi>
// → client.core, client.groups, client.seal, client.messaging
```

### Factory options reference

```ts
interface CreateSuiStackMessagingClientOptions<TApproveContext = void> {
  seal: SealClient | Omit<SealClientOptions, 'suiClient'>;
  encryption: SuiStackMessagingEncryptionOptions<TApproveContext>;
  packageConfig?: {
    messaging: SuiStackMessagingPackageConfig;          // localnet only
    permissionedGroups?: SuiGroupsPackageConfig;        // localnet only
  };
  suinsConfig?: SuinsConfig;                            // auto-detected
  relayer: RelayerConfig;                               // required
  attachments?: AttachmentsConfig;                      // optional
  recovery?: RecoveryTransport;                         // optional, Walrus fallback
}
```

`RelayerConfig` is either `{ relayerUrl, pollingIntervalMs?, transport?: never }` for
the built-in HTTP transport or `{ transport, relayerUrl?: never }` for a custom impl.

`SessionKeyConfig` has three tiers (signer-based, callback-based, full-manual). The
spike uses Tier 1 (`{ signer: keypair, ttlMin: 10 }`) since we own a `Keypair`.

## Client methods (real)

All live on `client.messaging` (a `SuiStackMessagingClient` instance). All take an
options bag with `signer: Signer` and a `groupRef: GroupRef` (`{ groupId, encryptionHistoryId } | { uuid }`).

### High-level messaging (relayer-dependent)

| Method | Signature highlights |
| --- | --- |
| `sendMessage(opts)` | `{ signer, groupRef, text?, files? }` → `{ messageId }`. At least one of `text`/`files`. Attachments require `attachments` configured. |
| `getMessage(opts)` | `{ signer, groupRef, messageId }` → `DecryptedMessage`. |
| `getMessages(opts)` | `{ signer, groupRef, afterOrder?, beforeOrder?, limit? }` → `{ messages: DecryptedMessage[], hasNext }`. Cursor pagination via order. |
| `editMessage(opts)` | `{ signer, groupRef, messageId, text, attachments? }` → `void`. Only the original sender can edit. |
| `deleteMessage(opts)` | `{ signer, groupRef, messageId }` → `void`. Soft delete; only sender. |
| `subscribe(opts)` | `{ signer, groupRef, afterOrder?, signal? }` → `AsyncIterable<DecryptedMessage>`. SDK wraps transport stream + decrypts. |
| `recoverMessages(opts)` | Recovery transport (e.g. Walrus). Read-only, no signer required. |

### Group management (mostly on-chain — the createGroup tx itself is on-chain, but the encryption history + relayer state aren't fully usable without a relayer)

| Method | Returns |
| --- | --- |
| `createAndShareGroup({ signer, name, initialMembers?, uuid?, transaction? })` | `{ digest, effects }` — also derives `groupId`/`encryptionHistoryId` from `uuid`. |
| `rotateEncryptionKey({ signer, ...GroupRef, transaction? })` | `{ digest, effects }`. |
| `removeMembersAndRotateKey({ signer, ...GroupRef, members, transaction? })` | atomic remove + rotate. |
| `leave({ signer, groupId, transaction? })` | self-remove. |
| `archiveGroup({ signer, groupId, transaction? })` | requires `PermissionsAdmin`. |
| `setGroupName({ signer, groupId, name, transaction? })` | requires `MetadataAdmin`. |
| `insertGroupData / removeGroupData` | KV in group metadata. |
| `setSuinsReverseLookup / unsetSuinsReverseLookup` | requires `ExtensionPermissionsAdmin`. |

### Supporting extensions

- `client.groups` — `SuiGroupsClient` for fine-grained permissioned group ops (e.g.
  `client.groups.grantPermission({...})`).
- `client.seal` — raw `SealClient` for encrypt/decrypt if you need lower-level access.
- `client.core` — base Sui RPC (`getRpcApiVersion`, `getCoins`, etc.).

### Lower-level helpers exposed on `client.messaging`

- `call` — `SuiStackMessagingCall`: build PTBs without signing.
- `tx` — `SuiStackMessagingTransactions`: same, transactions-only.
- `view` — `SuiStackMessagingView`: read-only view fns (e.g. encrypted key fetch).
- `bcs` — BCS schemas + parsers.
- `derive` — UUID → object ID derivation.
- `encryption` — `EnvelopeEncryption` (DEK + Seal).
- `transport` — raw `RelayerTransport` (use the high-level methods unless you really need this).

## Testnet constants

These come from the SDK's `TESTNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG` export and
the Mysten reference deployment.

| Field | Value |
| --- | --- |
| gRPC baseUrl | `https://fullnode.testnet.sui.io:443` (same endpoint serves JSON-RPC + gRPC-Web) |
| Messaging package (orig=latest @ v0.0.2) | `0x047696be0e98f1b47a99727fecf2955cadb23c56f67c6b872b74e3ad59d51b46` |
| Messaging namespace | `0x9442bdc5c0aef62b2c9ac797db3f74db9c99400547992d8fb49cc7b0ef709cf2` |
| Seal key server #1 | `0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75` |
| Seal key server #2 | `0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8` |
| Walrus publisher | `https://publisher.walrus-testnet.walrus.space` |
| Walrus aggregator | `https://aggregator.walrus-testnet.walrus.space` |
| Faucet (v2) | `POST https://faucet.testnet.sui.io/v2/gas`, body `{"FixedAmountRequest":{"recipient":"0x..."}}` |

## Verified working without gas

The spike runs a **gas-free Seal probe** (`messagingClient.messaging.encryption.generateGroupDEK()`)
that exercises the full Seal threshold encryption path — talks to both Seal key
servers, generates a DEK, Seal-encrypts it — and returns a ~388-byte encrypted
DEK. This succeeds even when the wallet has zero SUI. **Confirms: Seal on
testnet does not require gas.** Only on-chain operations
(`createAndShareGroup`, `rotateEncryptionKey`, etc.) need a funded wallet.

## Prerequisites for a full end-to-end spike run

The spike (`pnpm tsx scripts/spike-sdk.ts`) needs three things to pass beyond the
RPC + SDK init + Seal stages:

1. **`.env` or `.env.testnet` with `SUI_PRIVATE_KEY`.** The spike loader reads
   `.env` first then `.env.testnet` (testnet overrides). Generate with
   `pnpm tsx scripts/gen-testnet-wallet.ts` (prints the key + hits the faucet);
   copy the `SUI_PRIVATE_KEY=...` line into `.env.testnet` (gitignored). Real keys
   are never written to disk by the generator — the user owns the secret material.
2. **A funded wallet.** The generator script attempts the faucet for you; if it
   fails (rate limit), run `pnpm tsx scripts/gen-testnet-wallet.ts --no-faucet` and
   request via the web faucet at <https://faucet.sui.io>.
3. **A running relayer.** No public hosted relayer exists. Run the reference one:
   ```bash
   cd /Users/waynekuo/Documents/GitHub/sui-stack-messaging/relayer
   # see its README for build/run instructions
   ```
   Default URL in the spike: `http://localhost:3000`. Override with `RELAYER_URL`.

The spike degrades gracefully (exit 0 with a clear diagnostic) when:
- the relayer is unreachable (ECONNREFUSED / fetch failed / DNS errors), OR
- the wallet has no SUI to pay gas for `createAndShareGroup`.

It only exits 1 on unexpected errors (bad keypair, RPC outage, library mismatch).

## Open questions / next steps

- **Group discovery.** The SDK methods all take a `GroupRef` (either explicit
  `groupId`+`encryptionHistoryId` or a `uuid` that derives both). The plan
  mentions `getMessagesForGroup`/list-groups but neither lives on the high-level
  client API in v0.0.2. To enumerate groups for an address we either need to
  (a) query `client.groups.*` for membership events, (b) query Sui events
  directly, or (c) use SuiNS reverse lookup. The chat-app reference uses
  `SuiGraphQLClient` for this — worth investigating whether to depend on
  `@mysten/sui/graphql` for MCP `list_channels` semantics.
- **Recovery transport.** The `recovery` factory option enables reading historic
  messages from Walrus without the relayer. This is the obvious match for the
  Walrus Agent Stack value prop; figure out which `RecoveryTransport`
  implementation ships (or whether we need to write one against the
  `WalrusHttpStorageAdapter`).
- **`@mysten/sui` major.** v0.0.2 peer-declares `@mysten/sui ^2.13.2` and our
  installed v2.16.3 matches. If we later need a v3 API (e.g. for new gRPC
  features) we'll need to wait for the SDK to update its peer range.
- **Config integration.** The spike inlines testnet defaults rather than going
  through `src/config.ts` (which requires a valid `relayerUrl`). When we wire
  the SDK into the MCP server proper, extend `ConfigSchema` to accept optional
  Walrus URLs and a more permissive relayer policy.

## Files touched in T3

- `scripts/spike-sdk.ts` — end-to-end SDK initialization spike with graceful
  relayer/funding fallback.
- `scripts/gen-testnet-wallet.ts` — ephemeral testnet keypair generator + faucet.
- `.env.testnet.example` — template, committed.
- `.gitignore` — added `.env.testnet*` and `.env.mainnet*`.
- `package.json` / `pnpm-lock.yaml` — added `@mysten/seal` and `@mysten/sui-groups`
  (peer dependencies of `@mysten/sui-stack-messaging` that must be installed for
  the factory to run at all).
