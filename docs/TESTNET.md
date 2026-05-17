# Testnet Deployment Notes

Sui testnet is the **primary supported environment** for walrus-agent-stack
today. All integration tests, the D2 demo script, and the `bin/init.js`
faucet flow target testnet.

## Quick start

```bash
# 1. Generate a fresh keypair + hit the testnet faucet
pnpm tsx scripts/gen-testnet-wallet.ts        # one-shot, prints SUI_PRIVATE_KEY=...
#   ── or ──
npx walrus-agent-stack                         # initialises ~/.walrus-agent-stack/

# 2. Run a sui-stack-messaging relayer (required for channel.send / history)
cd /path/to/sui-stack-messaging/relayer
SUI_RPC_URL=https://fullnode.testnet.sui.io:443 ... cargo run    # see relayer/README.md

# 3. Set environment and run the MCP server
export SUI_PRIVATE_KEY=suiprivkey1qz...
export SUI_NETWORK=testnet
export RELAYER_URL=http://localhost:3000
export SEAL_SERVERS=<paste from below>
pnpm build && node dist/cli.js
```

## Network constants

| Field                        | Value                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| Sui RPC (gRPC-Web + JSON-RPC)| `https://fullnode.testnet.sui.io:443`                                                 |
| Sui faucet (v2)              | `POST https://faucet.testnet.sui.io/v2/gas` (fallback `/gas`)                         |
| Sui faucet web               | <https://faucet.sui.io>                                                               |
| Walrus publisher             | `https://publisher.walrus-testnet.walrus.space`                                       |
| Walrus aggregator            | `https://aggregator.walrus-testnet.walrus.space`                                      |
| Seal Move package            | `0x4016869413374eaa71df2a043d1660ed7bc927ab7962831f8b07efbc7efdb2c3`                  |
| sui-stack-messaging package  | `0x047696be0e98f1b47a99727fecf2955cadb23c56f67c6b872b74e3ad59d51b46` (auto-detected)  |

Source: <https://seal-docs.wal.app/UsingSeal> + `@mysten/sui-stack-messaging`
exported constants. Re-verify before mainnet cutover.

## Seal key servers — pick at least two

All testnet Seal key servers below run in **Open mode** (no API key; only
source-IP rate limiting). Pick 2+ providers for a quorum that survives one
operator going down. The constants are also cached in `src/config.ts` under
`KNOWN_SEAL_SERVERS_TESTNET` for in-source documentation.

### Verified independent key servers (testnet)

| Operator        | Object ID                                                                | URL                                                              |
| --------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| mysten-testnet-1| `0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75`     | `https://seal-key-server-testnet-1.mystenlabs.com`               |
| mysten-testnet-2| `0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8`     | `https://seal-key-server-testnet-2.mystenlabs.com`               |
| Ruby Nodes      | `0x6068c0acb197dddbacd4746a9de7f025b2ed5a5b6c1b1ab44dade4426d141da2`     | `https://seal-testnet.api.rubynodes.io`                          |
| NodeInfra       | `0x5466b7df5c15b508678d51496ada8afab0d6f70a01c10613123382b1b8131007`     | `https://open-seal-testnet.nodeinfra.com`                        |
| Studio Mirai    | `0x164ac3d2b3b8694b8181c13f671950004765c23f270321a45fdd04d40cccf0f2`     | `https://open.key-server-testnet.seal.mirai.cloud`               |
| Overclock       | `0x9c949e53c36ab7a9c484ed9e8b43267a77d4b8d70e79aa6b39042e3d4c434105`     | `https://seal-testnet-open.overclock.run`                        |
| H2O Nodes       | `0x39cef09b24b667bc6ed54f7159d82352fe2d5dd97ca9a5beaa1d21aa774f25a2`     | `https://seal-open.sui-testnet.h2o-nodes.com`                    |
| Triton One      | `0x4cded1abeb52a22b6becb42a91d3686a4c901cf52eee16234214d0b5b2da4c46`     | `https://seal.testnet.sui.rpcpool.com`                           |
| Natsai          | `0x3c93ec1474454e1b47cf485a4e5361a5878d722b9492daf10ef626a76adc3dad`     | `https://seal-open-test.natsai.xyz`                              |

### Verified decentralized committee (testnet)

A single object ID fronts a **3-of-5 threshold committee** (Mysten Labs,
Natsai, Overclock, NodeInfra, Ruby Nodes). Better liveness than picking
two independents, and counts as **one** server in `serverConfigs`.

| Field             | Value                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| Committee object  | `0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98`        |
| Aggregator URL    | `https://seal-aggregator-testnet.mystenlabs.com`                            |
| Threshold         | 3-of-5                                                                       |

Preferred default for new apps.

## Recommended `SEAL_SERVERS` values

### Most resilient — two independent operators

Pick any two operators from the table (different organizations):

```ini
# Mysten + Ruby Nodes
SEAL_SERVERS=0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75,0x6068c0acb197dddbacd4746a9de7f025b2ed5a5b6c1b1ab44dade4426d141da2
```

### Mysten-only (matches sui-stack-messaging/chat-app)

What the reference chat-app ships with — fine for unit/dev work:

```ini
SEAL_SERVERS=0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75,0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8
```

### Decentralized committee (single ID, 3-of-5)

```ini
SEAL_SERVERS=0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98
```

## Verifying the setup

```bash
# Confirm RPC + gRPC + Seal-only path (no relayer, no gas required)
pnpm tsx scripts/spike-sdk.ts
```

Expected output ends with:

```
--- gas-free Seal probe: generateGroupDEK ---
Seal-encrypted DEK OK — uuid=<uuid> encryptedDek=388 bytes
```

If the Seal probe fails:

- `InvalidKeyServerError` / `SealQuorumFailed` → at least one ID in
  `SEAL_SERVERS` is wrong or the server is down. Try a different
  operator from the table above.
- Network errors → check `https://fullnode.testnet.sui.io:443` is
  reachable from your network.

The relayer-dependent probe (`createAndShareGroup`) will fail with
"WALLET NOT FUNDED" until you hit the faucet, and with
"RELAYER UNREACHABLE" until you have a relayer running on
`RELAYER_URL`. Both are expected and don't block the Seal verification.

## Cross-references

- `src/config.ts` — `KNOWN_SEAL_SERVERS_TESTNET`, `SEAL_TESTNET_COMMITTEE_AGGREGATOR`, `SEAL_PACKAGE_ID_TESTNET`
- `docs/sdk-notes.md` — SDK shape, `createSuiStackMessagingClient` factory wiring
- `docs/MAINNET.md` — when/how to move off testnet
- `scripts/spike-sdk.ts` — runnable RPC + Seal smoke
- `tests/e2e/d2-demo.mjs` — full two-wallet E2E (needs relayer)
