import { z } from 'zod';
import type { ToolDef } from '../mcp/dispatch.js';
import type { Dispatcher } from '../mcp/dispatch.js';
import { SystemDebugArgs, EmptyArgs } from '../schemas.js';
import type { ToolLog } from '../logging.js';
import type { Outbox } from '../outbox.js';

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
