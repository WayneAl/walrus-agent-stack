import { z } from 'zod';
import type { ToolDef } from '../mcp/dispatch.js';
import type { Dispatcher } from '../mcp/dispatch.js';
import { SystemDebugArgs, EmptyArgs } from '../schemas.js';
import type { ToolLog } from '../logging.js';
import type { Outbox } from '../outbox.js';
import type { SdkContext } from '../sdk-client.js';
import { webFaucetUrl } from '../errors.js';

export function debugTool(log: ToolLog): ToolDef<z.infer<typeof SystemDebugArgs>> {
  return {
    name: 'system_debug',
    description:
      'Return the most recent tool-call log entries (tool, duration, error code) for troubleshooting failed calls.',
    schema: SystemDebugArgs,
    handler: async ({ limit }) => ({
      entries: log.tail(limit),
    }),
  };
}

interface ResendResult {
  id: string;
  status: 'sent' | 'failed';
  result?: unknown;
  error?: unknown;
}

export function resendTool(
  outbox: Outbox,
  dispatcher: Dispatcher,
): ToolDef<z.infer<typeof EmptyArgs>> {
  return {
    name: 'system_resend',
    description:
      'Retry every channel_send that was queued to the outbox after a network/Walrus failure (RELAYER_UNREACHABLE / WALRUS_UNAVAILABLE).',
    schema: EmptyArgs,
    handler: async () => {
      const pending = outbox.pending();
      const results: ResendResult[] = [];
      for (const item of pending) {
        outbox.incrementAttempt(item.id);
        try {
          const r = await dispatcher.invoke(item.tool, item.args);
          outbox.markDone(item.id);
          results.push({ id: item.id, status: 'sent', result: r });
        } catch (e: unknown) {
          results.push({ id: item.id, status: 'failed', error: e });
        }
      }
      return { processed: results };
    },
  };
}

interface HealthCheck {
  ok: boolean;
  detail?: string;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
// Late-bound so tests can spy on globalThis.fetch.
const defaultFetch: FetchLike = (url, init) => fetch(url, init);

export function healthTool(
  sdk: SdkContext,
  fetchImpl: FetchLike = defaultFetch,
): ToolDef<z.infer<typeof EmptyArgs>> {
  return {
    name: 'system_health',
    description:
      'Check connectivity (Sui RPC + wallet balance, message transport, Walrus, Seal config). Call when channel or memory tools fail unexpectedly.',
    schema: EmptyArgs,
    handler: async () => {
      const address = sdk.keypair.toSuiAddress();
      const { relayerUrl } = sdk.config;
      // Run independent probes concurrently — allSettled keeps the handler
      // resilient to any single probe throwing, no try/catch ladder needed.
      const [rpcRes, remoteRes] = await Promise.allSettled([
        sdk.client.core.getBalance({ owner: address }),
        relayerUrl
          ? fetchImpl(relayerUrl + '/health_check', { signal: AbortSignal.timeout(3000) })
          : fetchImpl(sdk.config.walrusAggregatorUrl, { signal: AbortSignal.timeout(3000) }),
      ]);

      const checks: Record<string, HealthCheck> = {};

      if (rpcRes.status === 'fulfilled') {
        // `balance.balance` is a Mist amount as a decimal string in the gRPC
        // shape (see GetBalanceResponse in @mysten/sui/dist/client/types.d.mts).
        // Coerce defensively in case the runtime ever surfaces a bigint.
        const amount = String(rpcRes.value.balance.balance);
        checks.rpc = { ok: true, detail: `balance: ${amount} mist` };
      } else {
        checks.rpc = { ok: false, detail: errorMessage(rpcRes.reason) };
      }

      const remote: HealthCheck =
        remoteRes.status === 'fulfilled'
          ? // Any HTTP answer from the aggregator root means it is reachable.
            { ok: relayerUrl ? remoteRes.value.ok : true, detail: `status: ${remoteRes.value.status}` }
          : { ok: false, detail: errorMessage(remoteRes.reason) };

      if (relayerUrl) {
        checks.relayer = remote;
        // Walrus + Seal sit behind the relayer; its probe is the proxy.
        checks.walrus = { ok: remote.ok, detail: 'tested via relayer' };
        checks.seal = { ok: remote.ok, detail: 'tested via relayer' };
      } else {
        // Serverless: messages go straight to Sui (rpc probe) + Walrus.
        checks.relayer = { ok: true, detail: 'serverless (Sui + Walrus)' };
        checks.walrus = remote;
        const n = sdk.config.sealServers.length;
        checks.seal = { ok: n > 0, detail: `${n} key server(s) configured` };
      }

      const allOk = Object.values(checks).every((c) => c.ok);
      return { status: allOk ? 'ok' : 'degraded', address, checks };
    },
  };
}

const MIST_PER_SUI = 1_000_000_000;
const MIN_BALANCE_MIST = 50_000_000; // 0.05 SUI
const FAUCET_ENDPOINTS = ['https://faucet.testnet.sui.io/v2/gas', 'https://faucet.testnet.sui.io/gas'];

export interface FaucetOutcome {
  ok: boolean;
  endpoint?: string;
  status?: number;
  detail?: string;
}

/** Testnet faucet: v2 first, the legacy endpoint on 404 / network error. */
export async function requestTestnetFaucet(
  recipient: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<FaucetOutcome> {
  const body = JSON.stringify({ FixedAmountRequest: { recipient } });
  let last: FaucetOutcome = { ok: false, detail: 'no faucet endpoint reachable' };
  for (const endpoint of FAUCET_ENDPOINTS) {
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return { ok: true, endpoint, status: res.status };
      const text = await res.text().catch(() => '');
      last = { ok: false, endpoint, status: res.status, detail: text.slice(0, 300) };
      if (res.status !== 404) return last; // rate limit etc.: the other endpoint shares the quota
    } catch (e: unknown) {
      last = { ok: false, endpoint, detail: errorMessage(e) };
    }
  }
  return last;
}

export function setupTool(
  sdk: SdkContext,
  fetchImpl: FetchLike = defaultFetch,
): ToolDef<z.infer<typeof EmptyArgs>> {
  return {
    name: 'system_setup',
    description:
      "First-run setup: report this agent's Sui address, network and SUI balance; on testnet with under 0.05 SUI, request gas from the faucet. " +
      'Every message costs a small gas fee, so run this before creating or joining channels and share the address with collaborators.',
    schema: EmptyArgs,
    handler: async () => {
      const address = sdk.keypair.toSuiAddress();
      const { network } = sdk.config;
      const readMist = async () =>
        Number((await sdk.client.core.getBalance({ owner: address })).balance.balance);
      let mist = await readMist();
      let faucet: FaucetOutcome | undefined;
      if (network === 'testnet' && mist < MIN_BALANCE_MIST) {
        faucet = await requestTestnetFaucet(address, fetchImpl);
        if (faucet.ok) mist = await readMist().catch(() => mist);
      }
      const funded = mist >= MIN_BALANCE_MIST;
      const web_faucet = webFaucetUrl(address);
      const next_steps = funded
        ? 'Ready. Share your address with collaborators. To start: channel_create with their address in `members`, then send them the channel_id; to join theirs: channel_join, then channel_wait to listen.'
        : faucet?.ok
          ? 'Faucet request accepted; the balance can take a few seconds to show. Run system_setup again to confirm.'
          : network === 'testnet'
            ? `Automatic faucet failed. Open ${web_faucet} in a browser to request testnet SUI, then run system_setup again.`
            : `Send SUI to ${address} to pay for gas, then run system_setup again.`;
      return {
        address,
        network,
        balance_sui: mist / MIST_PER_SUI,
        funded,
        ...(faucet ? { faucet } : {}),
        web_faucet,
        next_steps,
      };
    },
  };
}
