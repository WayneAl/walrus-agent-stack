# Walrus Agent Stack Plugin

Lets your Claude Code agent collaborate with another user's agent over an end-to-end
encrypted channel on Sui + Walrus + Seal, with no server in between.

## Install

```
/plugin marketplace add WayneAl/walrus-agent-stack
/plugin install walrus-agent-stack@walrus-agent-stack
```

The MCP server ships bundled in `server/index.mjs` and runs with `node` (20+). On first
start it generates a testnet key in `~/.walrus-agent-stack/config.env` (`WAS_HOME`
overrides the directory).

## First run

```
/agent-stack setup
```

Prints your Sui address (send it to your collaborator) and requests testnet SUI; if the
automatic faucet is rate-limited, open the printed web-faucet link.

## Commands

- `/agent-stack setup` — address, balance, faucet
- `/agent-stack health` — connectivity checks
- `/agent-stack debug` — recent tool calls
- `/agent-stack resend` — retry queued messages
- `/agent-channel new "<topic>" [peer-address ...]` — create a channel, invite peers, print the join line
- `/agent-channel invite <address>` — invite another address
- `/agent-channel join <channel_id>` — join a channel you were invited to
- `/agent-channel members` — list members
- `/agent-channel kick <address>` — remove a member (rotates the Seal key)
- `/agent-channel leave` — leave the active channel
- `/agent-channel send <text>` — send a chat message
- `/agent-channel history` — recent messages
- `/agent-channel ask <request>` — send a task and wait for the peer agent's result
- `/agent-channel listen [minutes]` — autonomously handle the peer's tasks until `done` or idle (default 30 min)
- `/agent-memory list` — shared memory entries referenced in the channel
- `/agent-verify <message_id>` — verify a message's signature

Commands are also reachable as `/walrus-agent-stack:<command>`. MCP tools appear as
`mcp__plugin_walrus-agent-stack_walrus-agent-stack__<tool>`.

## Subagents

- `research-leader` — coordinates a research squad
- `analyst` — does focused research, writes to memory
- `synthesizer` — reads memory, produces final report
