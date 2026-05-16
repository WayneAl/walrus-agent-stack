# Mainnet Deployment Notes

This document describes how to point a walrus-agent-stack MCP instance at
Sui mainnet. **Smoke testing on mainnet is pending** — see
[Status](#status-not-yet-verified-on-mainnet) below.

## Status: not yet verified on mainnet

The six core flows below have been verified end-to-end on **testnet** (see
the D2 demo in `tests/e2e/d2-demo.mjs`), but have **not** yet been
exercised on mainnet. Smoke testing requires:

- A funded mainnet Sui wallet (≈5 SUI).
- A running sui-stack-messaging relayer pointed at mainnet (there is no
  public hosted relayer at this time).
- Known mainnet Seal key-server object IDs (see
  [Prereqs to verify](#prereqs-to-verify)).

Flows to verify on mainnet:

- [ ] `channel.create`
- [ ] `channel.send` + `channel.history`
- [ ] `memory.write` + `memory.read`
- [ ] `channel.invite` + `channel.join`
- [ ] `channel.kick` + key rotation
- [ ] `identity.verify`

Once a funded wallet + running relayer are available, run the smoke flow
documented under [Smoke test](#smoke-test) and tick the boxes above with
the verification date.

## Prereqs to verify

1. **Run a mainnet relayer.** There is no public hosted
   sui-stack-messaging relayer; you must operate one yourself or use a
   private hosted instance. Clone
   `https://github.com/MystenLabs/sui-stack-messaging`, follow
   `relayer/README.md`, configure it with a mainnet `SUI_RPC_URL`
   (`https://fullnode.mainnet.sui.io:443`), and note the relayer's URL.

2. **Discover mainnet Seal key servers.** The `@mysten/seal` SDK no
   longer ships an allowlist helper. Consult the official Seal
   documentation for the current mainnet key-server object IDs. Record
   them as a comma-separated list, e.g.
   `0x<id1>,0x<id2>` — typically two or three servers.

   > **TBD:** discover mainnet key servers from `@mysten/seal` docs or
   > the Mysten Labs Seal deployment manifest, then replace this note
   > with the concrete IDs.

3. **Provision a mainnet wallet.**

   ```bash
   node bin/init.js
   ```

   This prints a new Sui address. Send ≈5 SUI to it from any mainnet
   wallet (Sui Wallet, Suiet, OKX, etc.).

4. **Edit `~/.walrus-agent-stack/config.env`** (or the equivalent
   `.env.alice` / `.env.bob` files used by the E2E demo):

   ```ini
   SUI_NETWORK=mainnet
   # From step 1 — your mainnet relayer:
   RELAYER_URL=https://relayer.your-org.example/mainnet
   # From step 2 — mainnet Seal allowlisted key servers (TBD):
   SEAL_SERVERS=0x<id1>,0x<id2>
   # Optional override; the default is fine:
   SUI_RPC_URLS=https://fullnode.mainnet.sui.io:443
   SUI_PRIVATE_KEY=suiprivkey1qz...
   ```

   Notes:
   - `RELAYER_URL` is **required** on mainnet. The placeholder
     `https://relayer.mainnet.example.com` baked into `src/config.ts` is
     non-functional and will fail at runtime.
   - `SEAL_SERVERS` is **required**; the stack does not auto-populate
     mainnet Seal IDs.
   - `SUI_NETWORK=mainnet` is the only switch that routes traffic to
     mainnet. Without it, the stack continues to use testnet defaults.

## Smoke test

Once the prereqs above are satisfied, the smoke runner is the existing
E2E demo script — no new tooling is required:

```bash
# Populate .env.alice and .env.bob with mainnet config (per the
# template in step 4 above), then:
pnpm test:e2e:mjs

# Or invoke the demo script directly:
SUI_NETWORK=mainnet node tests/e2e/d2-demo.mjs
```

Expected: the script runs the six flows listed under
[Status](#status-not-yet-verified-on-mainnet) and exits 0. Any tool
failure on mainnet (for example, a Seal key-server mismatch surfaced as
`InvalidKeyServerError`) should be filed as a bug, fixed in
`src/config.ts` or the relevant tool, and the demo re-run.

## Configuration reference

| Env var          | Mainnet value                              | Source                                  |
| ---------------- | ------------------------------------------ | --------------------------------------- |
| `SUI_NETWORK`    | `mainnet`                                  | user                                    |
| `SUI_PRIVATE_KEY`| `suiprivkey1qz...` (mainnet-funded wallet) | `bin/init.js`                           |
| `RELAYER_URL`    | self-hosted mainnet relayer URL            | user (see prereqs)                      |
| `SEAL_SERVERS`   | comma-separated mainnet Seal object IDs    | user (Seal docs — TBD)                  |
| `SUI_RPC_URLS`   | `https://fullnode.mainnet.sui.io:443`      | default                                 |

The sui-stack-messaging package IDs themselves do **not** need to be
configured — the SDK auto-detects them on mainnet via
`MAINNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG`.
