---
description: Operational commands (health/resend/debug)
allowed-tools: mcp__walrus-agent-stack__*
---

# /agent-stack

Read first word of $ARGUMENTS: `health`, `resend`, `debug`.

### health
Call `system.health` and print a status table.

### resend
Call `system.resend` and print how many were retried + their status.

### debug
Call `system.debug` with `limit: 20` and print recent tool calls.

## Args
$ARGUMENTS
