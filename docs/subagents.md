# Subagent Templates

## research-leader
Coordinates a research squad. Spawns analysts + synthesizer.

## analyst
Researches a single subtopic, writes findings as channel-scoped Walrus memory.

## synthesizer
Reads all memory in a channel, produces a final markdown report.

## Customization

Copy any template under `plugin/agents/` into your own plugin or session-level subagent config. Modify the prompt to your needs.
