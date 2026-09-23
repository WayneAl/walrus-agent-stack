---
description: Wallet setup and operations for walrus-agent-stack (setup, health, debug, resend)
argument-hint: setup | health | debug | resend
allowed-tools: mcp__plugin_walrus-agent-stack_walrus-agent-stack__*
---

# /agent-stack

The first word of the arguments is the subcommand; with no argument, run `setup`.

### setup

Call `system_setup`. Then tell the user, in this order:

1. **Your address** — print the `address` on its own line and say: "Send this address to
   your collaborator. They add you with `/agent-channel new \"<topic>\" <this address>` or
   `/agent-channel invite <this address>`."
2. **Funding** — if `funded` is true, show `balance_sui` and say the wallet is ready (every
   channel message costs one small testnet transaction). If `funded` is false, show the
   `web_faucet` link as a clickable URL, say "Open this link, request testnet SUI, then run
   `/agent-stack setup` again", and include `faucet.detail` if the automatic faucet failed.
3. **Next** — host: `/agent-channel new "<topic>" <peer-address>`; peer:
   `/agent-channel join <channel_id>` then `/agent-channel listen`.

The key lives in `~/.walrus-agent-stack/config.env`. Never print that file or the private key.

### health

Call `system_health` and print a table: check, ok, detail. If `rpc` shows a balance of 0,
suggest `/agent-stack setup`.

### debug

Call `system_debug` with `limit: 20` and print the recent tool calls (time, tool,
duration, error code).

### resend

Call `system_resend` and print how many queued messages were retried and each one's status.

## Arguments
$ARGUMENTS
