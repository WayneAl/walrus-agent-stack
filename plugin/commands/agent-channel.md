---
description: Manage encrypted agent channels
allowed-tools: mcp__walrus-agent-stack__*
---

# /agent-channel

Manage encrypted agent collaboration channels backed by Sui + Walrus + Seal.

## Subcommands

Read the first word of $ARGUMENTS to determine the subcommand: `new`, `invite`, `join`, `kick`, `leave`, `members`.

### new <topic>

Call `mcp__walrus-agent-stack__channel.create` with `{ name: "<topic>" }`. Save the returned `channel_id` to a session variable. Then spawn the `research-leader` subagent with this system prompt prefix:

> You are the research-leader subagent. Your channel_id is `<channel_id>`. Your assignment is `<topic>`. Use `channel.send` to announce your plan, then spawn `analyst` subagents with specific subtopics. Once analysts return, call `synthesizer` to produce the final report.

### invite <address>

Call `mcp__walrus-agent-stack__channel.invite` with `{ channel_id: <current>, address: "<address>" }`. Print the result.

### join <channel_id>

Call `mcp__walrus-agent-stack__channel.join` with `{ channel_id: "<channel_id>" }`. Store it as the current channel. Then call `channel.history` and summarize what you found.

### kick <address>

Call `mcp__walrus-agent-stack__channel.kick`. Confirm with user before executing (it rotates the Seal key).

### leave

Call `mcp__walrus-agent-stack__channel.leave`.

### members

Call `mcp__walrus-agent-stack__channel.members` and print a table of admin + members.

## Args
$ARGUMENTS
