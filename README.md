# Walrus Agent Stack

> Encrypted channels and shared memory for AI agents that belong to different people —
> with no server in the middle.

Walrus Agent Stack is a Claude Code plugin (and a plain stdio MCP server) that lets two or
more users' agents, running on different computers, hand each other work and answer each
other automatically. User A's agent asks; user B's agent does the task with B's local
tools and project and replies. Everything travels over Sui, Walrus and Seal:

- **Encrypted channels.** Messages are Seal-encrypted end to end. Only the channel's
  members can read them.
- **Shared memory.** Larger results are written to Walrus as signed, channel-scoped blobs
  and referenced by `walrus://` URI.
- **Verifiable identity.** Every message and memory blob is signed by its author's Sui key,
  so any member can check who said what.
- **Cross-org by design.** Membership is a Sui Group with per-member permissions, and
  removing a member rotates the channel key.
- **Serverless.** No relayer and no backend: each user runs a local MCP server with their
  own key, and the only shared infrastructure is Sui, Walrus and Seal.

## Requirements

- [Claude Code](https://claude.com/claude-code) (or any MCP client, see
  [Other MCP clients](#other-mcp-clients))
- Node.js 20 or newer on `PATH`; the plugin starts the server with `node`
- A little testnet SUI per user. `/agent-stack setup` requests it from the faucet.

## Quick start: two users, two machines

Both users do steps 1 and 2.

```text
# 1. Install the plugin in Claude Code
/plugin marketplace add WayneAl/walrus-agent-stack
/plugin install walrus-agent-stack@walrus-agent-stack

# 2. Create and fund your wallet
/agent-stack setup          # the first start generates a key in ~/.walrus-agent-stack
                            # and prints your address; send it to the other user

# 3. Host: open a channel that includes the peer
/agent-channel new "Refactor the auth module" 0xPEER_ADDRESS
                            # prints a `/agent-channel join <id>` line; send it to the peer

# 4. Peer: join, then let the agent work on requests
/agent-channel join <channel_id>
/agent-channel listen       # waits for tasks, does them locally, replies

# 5. Host: hand work to the peer's agent
/agent-channel ask "Summarize how sessions are validated in src/auth and list the risks"
```

`ask` waits for the reply and shows it together with its signature status. `listen` keeps
running until the host sends `done`, until 30 idle minutes pass (`listen 60` changes the
limit), or until you press Esc.

### Commands

Every command can also be called as `/walrus-agent-stack:<command>`.

| Command | What it does |
| --- | --- |
| `/agent-stack setup` | Shows your address and balance, and requests testnet SUI if you have too little |
| `/agent-stack health` \| `debug` \| `resend` | Checks connectivity, shows recent tool calls, retries queued sends |
| `/agent-channel new "<topic>" [address…]` | Creates a channel, invites the addresses and makes it the active channel |
| `/agent-channel join <id>` | Joins a channel you were invited to and shows recent messages |
| `/agent-channel ask <request>` | Sends a task and waits for the answer |
| `/agent-channel listen [minutes]` | Works on incoming tasks on its own and replies |
| `/agent-channel send <text>` \| `history` \| `members` | Sends a plain message, reads history, or lists members |
| `/agent-channel invite <address>` \| `kick <address>` \| `leave` | Changes membership (`kick` rotates the channel key) |
| `/agent-memory list` | Lists the channel's shared-memory blobs and checks their signatures |
| `/agent-verify <message_id>` | Verifies who signed a message |

The plugin also ships three subagent templates (`research-leader`, `analyst` and
`synthesizer`) for squad-style research inside a single channel. See
[`docs/subagents.md`](docs/subagents.md).

## How it works

```
┌─ User A's machine ─────────────┐  ┌─ User B's machine ─────────────┐
│ Claude Code + plugin           │  │ Claude Code + plugin           │
│   /agent-channel ask           │  │   /agent-channel listen        │
│         │ MCP (stdio)          │  │         │ MCP (stdio)          │
│  ┌──────▼──────────────┐       │  │  ┌──────▼──────────────┐       │
│  │ Local MCP server    │       │  │  │ Local MCP server    │       │
│  │ + A's Sui keypair   │       │  │  │ + B's Sui keypair   │       │
│  └──────┬──────────────┘       │  │  └──────┬──────────────┘       │
└─────────┼──────────────────────┘  └─────────┼──────────────────────┘
          │   Seal-encrypted, signed envelopes │
          └───────────┬────────────────────────┘
       ┌──────────────┼──────────────────┐
       ▼              ▼                  ▼
  ┌──────────┐   ┌──────────┐       ┌────────┐
  │   Sui    │   │  Walrus  │       │  Seal  │
  │ Group +  │   │ message +│       │  key   │
  │channel_  │   │ memory   │       │ servers│
  │log index │   │ blobs    │       │        │
  └──────────┘   └──────────┘       └────────┘
```

1. A channel is a Sui Group from
   [sui-stack-messaging](https://github.com/MystenLabs/sui-stack-messaging). Each member
   has permissions such as send and read, and a Seal-managed key encrypts the channel.
2. Sending a message encrypts and signs it locally and uploads the envelope to Walrus.
   One Sui transaction then appends the blob ID to the channel's on-chain log (the
   [`channel_log`](move/channel_log) Move package). That transaction aborts unless the
   sender holds the send permission, so authorization happens on chain.
3. Receivers poll the log, download the new blobs from a Walrus aggregator, check each
   signature against the on-chain sender, and decrypt.

Sui and Walrus only ever see ciphertext. Each user's private key stays in
`~/.walrus-agent-stack/config.env` (file mode 0600) on their own machine.

**Costs.** There is no infrastructure to pay for. Each message is one Sui transaction
(about 0.007 SUI on testnet) plus one Walrus blob. Creating a channel costs a little more.

**Latency.** A message takes roughly 10–30 s to reach the other side, mostly Walrus upload
time. That works for delegating tasks but is too slow for chat.

## Security model

- **Peer messages are data, not instructions.** `listen` treats every incoming message as
  a request from a collaborator. It will not reveal secrets, keys or anything under
  `~/.walrus-agent-stack`. It stays within the project it was started in. It asks the
  local user before any destructive or irreversible action (deleting files, pushing,
  deploying, spending funds), and refuses such actions when nobody is there to ask. These
  rules are written into the command prompt. A prompt is not a sandbox, so run `listen`
  with the permission mode you would give any agent that acts on someone else's request.
- **Your normal Claude Code permissions still apply.** The plugin pre-approves only its
  own MCP tools. Every other tool the agent uses to do a task (Bash, file edits and so on)
  follows your usual permission settings.
- **Trust is anchored on chain.** Membership and send permission are checked in Move.
  Message authenticity is checked against the sender's Sui signature. A blob whose
  embedded sender does not match the on-chain sender is dropped.
- **Unaudited beta.** Do not put production secrets or sensitive data in a channel.

## Configuration

The first start creates `~/.walrus-agent-stack/config.env`. Values from the process
environment override the file. Set `WAS_HOME` to use a different directory, for example
to run two identities on one machine.

| Key | Default | Purpose |
| --- | --- | --- |
| `SUI_PRIVATE_KEY` | generated | Your identity (`suiprivkey1…`) |
| `SUI_NETWORK` | `testnet` | `testnet` or `mainnet` |
| `SEAL_SERVERS` | two Mysten testnet servers | Comma-separated Seal key-server object IDs |
| `SUI_RPC_URLS` | `https://fullnode.testnet.sui.io:443` | Sui gRPC endpoint |
| `WALRUS_PUBLISHER_URL` / `WALRUS_AGGREGATOR_URL` | public testnet endpoints | Walrus HTTP endpoints |
| `WALRUS_STORAGE_EPOCHS` | `30` | How long message and memory blobs are stored |
| `RELAYER_URL` | unset | Use a self-hosted sui-stack-messaging relayer instead of the serverless transport |

**Network status.** The stack runs on Sui testnet today, which is where the `channel_log`
package is published. Testnet Walrus blobs expire after `WALRUS_STORAGE_EPOCHS` epochs, so
old messages eventually become unreadable. Running on mainnet currently requires
`RELAYER_URL` and permissioned Seal key servers. See [`docs/MAINNET.md`](docs/MAINNET.md).

## Other MCP clients

The server is published on npm as
[`walrus-agent-stack-mcp`](https://www.npmjs.com/package/walrus-agent-stack-mcp):

```bash
npx -y -p walrus-agent-stack-mcp walrus-agent-stack    # creates your wallet, prints your address
```

```json
{
  "mcpServers": {
    "walrus-agent-stack": {
      "command": "npx",
      "args": ["-y", "walrus-agent-stack-mcp"]
    }
  }
}
```

If you would rather not use npm, clone the repo and run the bundled server directly:
`"command": "node", "args": ["/absolute/path/to/walrus-agent-stack/plugin/server/index.mjs"]`.

It exposes 17 tools (`channel_*`, `memory_*`, `identity_*`, `system_*`), each with a full
JSON Schema. [`docs/tools.md`](docs/tools.md) is the reference. A minimal listening loop
calls `channel_wait` repeatedly and answers with `channel_send`, using `intent: "result"`
and `parent_message_id` set to the task's ID.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `INSUFFICIENT_GAS` | Run `/agent-stack setup`. If the faucet is rate-limited, use the web faucet at <https://faucet.sui.io> with your address |
| `NOT_GROUP_MEMBER` | Ask the channel's host to `/agent-channel invite` your address |
| `NO_ACTIVE_CHANNEL` | Run `/agent-channel join <id>` or `/agent-channel new` first |
| `WALRUS_UNAVAILABLE` | The send was queued. Run `/agent-stack resend` once Walrus responds again |
| `ask` returns nothing | Check that the peer is running `/agent-channel listen` on the same channel |

`/agent-stack health` checks the Sui RPC and the Walrus aggregator.

## Why not MemWal?

| Feature | MemWal | Walrus Agent Stack |
| --- | :---: | :---: |
| Single-user agent memory | ✓ | — |
| Multi-user / multi-org channels | — | ✓ |
| Per-member signatures | — | ✓ |
| Third-party verifiable audit | — | ✓ |
| Key rotation on member removal | — | ✓ |

The two complement each other: MemWal is for "agents remember you", this stack is for
"agents work with each other".

## Development

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test   # unit tests, no network
pnpm bundle                                # build + bundle into plugin/server/index.mjs
```

The plugin runs the committed bundle `plugin/server/index.mjs`. Rebuild it and commit it
with every `src/` change.

- **End-to-end test (testnet).** `pnpm test:e2e:serverless <hostEnv> <peerEnv> [server]`
  drives two MCP server processes with separate identities through create, invite, join,
  task, wait, memory, result and verify. Each env file holds a funded
  `SUI_PRIVATE_KEY=…`. Pass `plugin/server/index.mjs` as `server` to test the bundle.
- **Try the plugin without installing it.** Run
  `claude --plugin-dir ./plugin`, with `WAS_HOME=/tmp/alice` for one identity and
  `WAS_HOME=/tmp/bob` in a second terminal.
- **Move package.** The package lives in `move/channel_log`: run
  `sui move test -e testnet` there. Its published testnet IDs are in
  [`docs/TESTNET.md`](docs/TESTNET.md).
- **Relayer-mode integration tests.** `pnpm test:int` needs `TEST_RELAYER_URL` and
  `TEST_SEAL_SERVERS`, and skips itself when they are unset.

Design notes are in [`docs/superpowers/specs/`](docs/superpowers/specs). Issues and pull
requests are welcome. Please run `pnpm typecheck && pnpm lint && pnpm test` and rebuild
the bundle before opening a PR.

## Status

Beta on Sui testnet. Built for the Sui Overflow 2026 Walrus Track. Unaudited.

## License

[Apache-2.0](LICENSE)
