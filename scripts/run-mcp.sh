#!/usr/bin/env bash
# Usage: ./scripts/run-mcp.sh <alice|bob>
#
# Loads .env.<role> into the environment and execs the built MCP server
# (dist/cli.js) over stdio. Useful for manual interactive testing with real
# MCP clients (e.g. `npx @modelcontextprotocol/inspector`).
set -euo pipefail

ROLE="${1:-}"
if [ -z "$ROLE" ]; then
  echo "Usage: $0 <alice|bob>" >&2
  exit 1
fi

ENV_FILE=".env.$ROLE"
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

# Export non-comment, non-blank KEY=VALUE lines from the env file.
set -a
# shellcheck disable=SC1090
source <(grep -v '^[[:space:]]*#' "$ENV_FILE" | grep -E '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=')
set +a

exec node dist/cli.js
