# Walrus Agent Stack Plugin

Adds encrypted A2A channels + Walrus-backed shared memory + Sui-anchored identity to Claude Code.

## Install

```
/plugin marketplace add <repo-url>
/plugin install walrus-agent-stack
```

## First Run

```
npx walrus-agent-stack init
```

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
