#!/usr/bin/env bash
# D2 demo flow — Alice + Bob cross-org collaboration via MCP.
#
# NOTE: This shell script is a *manual-testing aid* — it pipes raw JSON-RPC into
# the MCP server's stdio. The MCP protocol uses LSP framing (Content-Length
# headers), so bare echo|jq pipelines won't get a response.
#
# For a real automated E2E:
#   - Use the official MCP inspector CLI: `npx @modelcontextprotocol/inspector`
#   - Or run the programmatic equivalent: `node tests/e2e/d2-demo.mjs`
#     (uses the @modelcontextprotocol/sdk Client + StdioClientTransport).
#
# This file is kept as a human-readable spec of the demo's steps. It will not
# print `ALL GREEN` end-to-end without an MCP-protocol-aware client wrapper.
set -euo pipefail

# Pre-flight
[ -f .env.alice ] || { echo "Missing .env.alice"; exit 1; }
[ -f .env.bob ] || { echo "Missing .env.bob"; exit 1; }
pnpm build

call() {
  local role=$1 tool=$2 args=$3
  local req
  req=$(jq -n --arg tool "$tool" --argjson args "$args" \
    '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:$tool,arguments:$args}}')
  echo "$req" | ./scripts/run-mcp.sh "$role" | jq -r '.result.content[0].text' | jq .
}

echo "[1/6] Alice creates channel"
RES=$(call alice channel.create '{"name":"e2e-test"}')
CHAN=$(echo "$RES" | jq -r '.channel_id')
echo "channel_id=$CHAN"

echo "[2/6] Alice sends a hello"
call alice channel.send "$(jq -n --arg c "$CHAN" '{channel_id:$c,content:"hello from alice"}')"

echo "[3/6] Alice writes memory"
WRITE=$(call alice memory.write "$(jq -n --arg c "$CHAN" '{channel_id:$c,key:"a.md",content:"alice findings"}')")
URI=$(echo "$WRITE" | jq -r '.uri')

echo "[4/6] Alice invites Bob"
BOB_ADDR=$(call bob identity.whoami '{}' | jq -r '.address')
call alice channel.invite "$(jq -n --arg c "$CHAN" --arg a "$BOB_ADDR" '{channel_id:$c,address:$a}')"

echo "[5/6] Bob joins, reads history, reads memory"
call bob channel.join "$(jq -n --arg c "$CHAN" '{channel_id:$c}')"
HIST=$(call bob channel.history "$(jq -n --arg c "$CHAN" '{channel_id:$c}')")
echo "$HIST" | jq -e '.messages[] | select(.body.text=="hello from alice")' > /dev/null
echo "  - Bob sees alice message"

READ=$(call bob memory.read "$(jq -n --arg u "$URI" '{uri:$u}')")
echo "$READ" | jq -e '.verified == true' > /dev/null
echo "  - Bob reads alice's memory with verified=true"

echo "[6/6] Bob sends back, Alice verifies"
SEND=$(call bob channel.send "$(jq -n --arg c "$CHAN" '{channel_id:$c,content:"bob here"}')")
BOB_MSG_ID=$(echo "$SEND" | jq -r '.message_id')
VERIFY=$(call alice identity.verify "$(jq -n --arg c "$CHAN" --arg m "$BOB_MSG_ID" '{channel_id:$c,message_id:$m}')")
echo "$VERIFY" | jq -e '.verified == true and .sender == "'"$BOB_ADDR"'"' > /dev/null
echo "  - Alice verifies Bob's signature"

echo ""
echo "ALL GREEN - D2 demo flow works."
