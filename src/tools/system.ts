import { z } from 'zod';
import type { ToolDef } from '../mcp/dispatch.js';
import type { Dispatcher } from '../mcp/dispatch.js';
import { SystemDebugArgs, EmptyArgs } from '../schemas.js';
import type { ToolLog } from '../logging.js';
import type { Outbox } from '../outbox.js';
import type { SdkContext } from '../sdk-client.js';

export function debugTool(log: ToolLog): ToolDef<z.infer<typeof SystemDebugArgs>> {
  return {
    name: 'system.debug',
    description: 'Return recent tool call log entries',
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
    name: 'system.resend',
    description: 'Retry all queued outbox messages',
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

export function healthTool(sdk: SdkContext): ToolDef<z.infer<typeof EmptyArgs>> {
  return {
    name: 'system.health',
    description: 'Check Sui RPC, relayer, Walrus, Seal, and wallet balance',
    schema: EmptyArgs,
    handler: async () => {
      const address = sdk.keypair.toSuiAddress();
      // Run independent probes concurrently — allSettled keeps the handler
      // resilient to any single probe throwing, no try/catch ladder needed.
      const [rpcRes, relayerRes] = await Promise.allSettled([
        sdk.client.core.getBalance({ owner: address }),
        fetch(sdk.config.relayerUrl + '/health', { signal: AbortSignal.timeout(3000) }),
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

      if (relayerRes.status === 'fulfilled') {
        const r = relayerRes.value;
        checks.relayer = { ok: r.ok, detail: `status: ${r.status}` };
      } else {
        checks.relayer = { ok: false, detail: errorMessage(relayerRes.reason) };
      }

      // Walrus + Seal: indirect — for the hackathon scope we use the relayer
      // probe as a proxy. Real probes land in later phases.
      checks.walrus = { ok: checks.relayer.ok, detail: 'tested via relayer' };
      checks.seal = { ok: checks.relayer.ok, detail: 'tested via relayer' };

      const allOk = Object.values(checks).every((c) => c.ok);
      return { status: allOk ? 'ok' : 'degraded', address, checks };
    },
  };
}
