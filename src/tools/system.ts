import { z } from 'zod';
import type { ToolDef } from '../mcp/dispatch.js';
import { SystemDebugArgs } from '../schemas.js';
import type { ToolLog } from '../logging.js';

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
