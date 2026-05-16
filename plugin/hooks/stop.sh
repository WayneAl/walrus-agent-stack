#!/usr/bin/env bash
# Stop hook — archive session summary to Walrus memory if a channel was active.
#
# Claude Code invokes plugin hooks with a JSON payload on stdin (e.g. containing
# `transcript_path` and other session metadata). This hook is a best-effort,
# fire-and-forget archive: it must never block Claude Code from finishing, so
# we exit 0 on every path — even when stdin is empty, jq is missing, or the
# MCP server is unreachable.
#
# NOTE: The summary body below is a placeholder. A future iteration will read
# the transcript at `transcript_path` and produce a real session summary
# (e.g. by piping it through a small summarizer). For now we archive a marker
# line so we can verify the hook fires end-to-end.

set +e

SESSION_FILE="$HOME/.walrus-agent-stack/session.json"
if [ ! -f "$SESSION_FILE" ]; then
  exit 0
fi

# Capture the hook payload from stdin (non-blocking; empty is fine).
STDIN_JSON=""
if [ ! -t 0 ]; then
  STDIN_JSON=$(cat 2>/dev/null || true)
fi

# Resolve channel + transcript path defensively (jq may be absent).
CHANNEL_ID=""
TRANSCRIPT_PATH=""
if command -v jq >/dev/null 2>&1; then
  CHANNEL_ID=$(jq -r '.channel_id // empty' "$SESSION_FILE" 2>/dev/null || true)
  if [ -n "$STDIN_JSON" ]; then
    TRANSCRIPT_PATH=$(printf '%s' "$STDIN_JSON" | jq -r '.transcript_path // empty' 2>/dev/null || true)
  fi
fi

if [ -z "$CHANNEL_ID" ]; then
  exit 0
fi

TS=$(date +%Y%m%dT%H%M%S)
SUMMARY="Session ended at ${TS}. transcript_path=${TRANSCRIPT_PATH:-<unknown>}. (placeholder — replace with real transcript summary)"
KEY="session-summary-${TS}.md"

# JSON-encode the summary safely if jq is available; otherwise inline a minimal escape.
if command -v jq >/dev/null 2>&1; then
  CONTENT_JSON=$(printf '%s' "$SUMMARY" | jq -Rs .)
else
  ESCAPED=${SUMMARY//\\/\\\\}
  ESCAPED=${ESCAPED//\"/\\\"}
  CONTENT_JSON="\"${ESCAPED}\""
fi

REQ="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"memory.write\",\"arguments\":{\"channel_id\":\"${CHANNEL_ID}\",\"key\":\"${KEY}\",\"content\":${CONTENT_JSON}}}}"

# Fire-and-forget: pipe the JSON-RPC request into the MCP server and detach.
printf '%s' "$REQ" | npx walrus-agent-stack-mcp >/dev/null 2>&1 &

exit 0
