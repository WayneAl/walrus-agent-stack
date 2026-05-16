---
description: Inspect channel-scoped Walrus memory
allowed-tools: mcp__walrus-agent-stack__*
---

# /agent-memory

Read $ARGUMENTS. Subcommand is the first word.

### list

Call `channel.history` for the current channel. Extract all `refs` from message bodies. For each ref, call `memory.read` and print a one-line summary:

```
<key> — <author> @ <timestamp> — ✓ verified — <content_type>
```

Highlight any with `verified: false` as ⚠️.

## Args
$ARGUMENTS
