# Phase 7 — Multi-Persona Channel Rehearsal

A self-contained command that mints N fresh testnet wallets, spawns one
memory-isolated MCP server per wallet, drives them through the full channel
matrix, and writes a structured timeline + summary that drives the Sui
Overflow 2026 demo video.

## What it proves

In one run, end-to-end on testnet:

- N fresh Ed25519 wallets generated and funded via the public faucet.
- N MCP servers, each its own subprocess with its own `SUI_PRIVATE_KEY` and
  `LOG_DIR` — true memory isolation at the wallet, transport, and log layers.
- Channel lifecycle: `create → invite → join → kick (with key rotation) →
  leave` exercised on real on-chain Groups.
- Messaging: `send → history` with signature verification by a third party
  via `identity.verify`.
- Walrus + Seal memory: `memory.write → memory.read` with `verified=true`
  decryption by a different persona than the author.
- Forward secrecy: post-kick `channel.send` from admin, post-kick
  `channel.history` from the kicked persona — the new message must NOT be
  readable by the kicked persona.

## Prereqs

1. `pnpm install && pnpm build` — the script spawns `dist/cli.js`.
2. A reachable sui-stack-messaging relayer. Locally:
   ```
   # in another terminal
   git clone … sui-stack-messaging-relayer && pnpm dev
   ```
3. Environment:
   ```
   export RELAYER_URL=http://localhost:3000
   export SEAL_SERVERS=<id1>,<id2>      # 2+ ids from docs/TESTNET.md
   # optional (defaults shown):
   export SUI_NETWORK=testnet
   export SUI_RPC_URLS=https://fullnode.testnet.sui.io:443
   export WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space
   export WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
   ```
   The `TEST_RELAYER_URL` / `TEST_SEAL_SERVERS` vars (used by the integration
   suite) are accepted as fallbacks.

## Run it

```
pnpm test:e2e:phase7
# or with flags
node scripts/phase7-rehearsal.mjs --personas 3 --out tmp/phase7 --keep
```

Flags:

| Flag | Default | Notes |
| --- | --- | --- |
| `--personas N` | 3 | Minimum 3. First three drive the scenario (Alice admin, Bob member, Carol joiner-then-kicked). Extras boot but stay idle. |
| `--out DIR` | `tmp/phase7` | Run subdir named `<UTC-stamp>-<rand>` is created underneath. |
| `--skip-faucet` | off | Skip faucet calls; use this if the addresses are already funded. |
| `--reuse-personas DIR` | — | Load private keys from a previous run's `env/` dir (alphabetical filename order). Implies `--skip-faucet`. |

Exit code: `0` if every assertion passes, `1` otherwise. The summary,
timeline, and `env/` directory are always written.

### Recommended flow when the CLI faucet rate-limits

The public testnet faucet (`https://faucet.testnet.sui.io/v2/gas`) rate-limits
by source IP. A first run from a fresh IP almost always succeeds; back-to-back
runs from the same IP routinely hit 429. The web faucet
(<https://faucet.sui.io>) has a separate, more generous quota.

When the script aborts with `insufficient SUI balance`, it prints a hint with
the three addresses and the exact resume command. Workflow:

```bash
# 1. First run (fails on gas, prints addresses)
node scripts/phase7-rehearsal.mjs --personas 3 --skip-faucet

# 2. Open https://faucet.sui.io and request testnet SUI for each printed
#    address (alice, bob, carol).

# 3. Resume using the same keys that were just funded:
node scripts/phase7-rehearsal.mjs --reuse-personas tmp/phase7/<runId>/env
```

## What you get

```
<out>/<runId>/
├── timeline.jsonl   # one JSON event per line — boots + every tool call
├── summary.md       # human-readable run report (personas, channel id, ✓/✗ steps)
├── logs/
│   ├── alice/YYYY-MM-DD.jsonl   # per-persona MCP tool log
│   ├── bob/...
│   └── carol/...
└── env/             # removed unless --keep (each .env.<label> holds a key)
```

`timeline.jsonl` event shape:

```json
{"ts":"2026-05-17T12:34:56.789Z","type":"step","persona":"alice",
 "address":"0x…","stepName":"create","tool":"channel.create",
 "args":{"name":"phase7-rehearsal","members":["0x…"]},
 "result":{"channel_id":"…","group_id":"…","digest":"…","admin":"0x…"},
 "latencyMs":2310}
```

## For the demo video

1. **As a screencast**:
   ```
   asciinema rec demo.cast -- pnpm test:e2e:phase7
   ```
   The script's stdout is already structured (`[mint] / [faucet] / [spawn] /
   [scenario]` sections with `✓` marks per step) and is the easiest thing to
   show on-screen.

2. **As a narrated overlay**: read `summary.md` aloud while showing the
   timeline scroll. Each `step` event in `timeline.jsonl` is one call/response
   beat that can be cut into a typed-out animation in post.

3. **Verifiability claim**: every step references on-chain digests
   (`result.digest`) and Seal-encrypted message IDs (`result.message_id`).
   Reviewers can replay the timeline against testnet to confirm the
   addresses, channel id, and message ids exist and decode as recorded.

## Troubleshooting

- **Faucet returns 429**: the testnet faucet is rate-limited. Wait a few
  minutes or run with `--skip-faucet` against pre-funded addresses.
- **`RELAYER_UNREACHABLE` on `channel.send`**: relayer is down. Each MCP
  server queues to its outbox (`<out>/<runId>/logs/<persona>/../outbox/`) —
  start the relayer and the next run will succeed.
- **`MISSING_CHANNEL_HINT` on `memory.read`**: the walrus URI was passed
  without `?channel=`. The orchestrator always includes the hint; if you see
  this you're probably running an older `dist/cli.js`. Rerun `pnpm build`.
- **Carol still reads the post-rotation message**: the `key_rotated=true`
  assertion in `channel.kick` is set unconditionally by the tool; the real
  proof is the `carol-post-kick-history` step. If Carol decrypts it, the
  relayer or SDK rotation path regressed — file a bug.
