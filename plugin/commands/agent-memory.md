---
description: List the shared Walrus memory entries referenced in the active channel
argument-hint: list [channel_id]
allowed-tools: mcp__plugin_walrus-agent-stack_walrus-agent-stack__*
---

# /agent-memory

The first word of the arguments is the subcommand (default `list`).

### list

Call `channel_history` (`channel_id` = the second argument if given, else the active
channel; `limit: 500`). Collect every URI in the messages' `refs`. For each, call
`memory_read` and print one line:

```
<uri> — <author> (<author_agent_id>) @ <created_at_ms as ISO time> — <content_type> — verified | TAMPERED
```

Mark any result with `warning: "MEMORY_TAMPERED"` clearly. If there are no refs, say so.

## Arguments
$ARGUMENTS
