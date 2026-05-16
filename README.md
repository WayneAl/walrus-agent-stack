# Walrus Agent Stack

Walrus-backed shared memory and encrypted channels for any MCP agent.

## Integration testing

Set these env vars before running `pnpm test:int`:
- `TEST_RELAYER_URL` — testnet relayer endpoint
- `TEST_SEAL_SERVERS` — comma-separated Seal server object IDs (testnet)

Integration test suites should gate themselves with
`describe.skipIf(!hasIntegrationEnv())` (exported from
`tests/integration/helpers/fixture.ts`) so the default `pnpm test` run silently
skips them when the env vars are not set, instead of failing.
