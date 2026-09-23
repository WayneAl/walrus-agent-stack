# Subagent Templates

The plugin bundles three subagents under `plugin/agents/` for a single-machine research
squad that shares its results through a channel. They call the plugin's MCP tools
(`mcp__plugin_walrus-agent-stack_walrus-agent-stack__*`) by short name: `channel_send`,
`channel_wait`, `channel_history`, `memory_write`, `memory_read`.

## research-leader
Coordinates a research squad. Announces a plan with `channel_send`, spawns analysts
(Agent tool), waits with `channel_wait` (`include_own: true`, since the analysts share
this machine's key), then spawns the synthesizer.

## analyst
Researches a single subtopic, writes findings with `memory_write`, and posts the
`walrus://` URI in a `channel_send` `refs`.

## synthesizer
Reads the channel's `refs` via `channel_history` + `memory_read`, produces a final markdown
report and posts it with `memory_write` + `channel_send`.

## Customization

Copy any template under `plugin/agents/` into your own plugin or session-level subagent
config. Modify the prompt to your needs.
