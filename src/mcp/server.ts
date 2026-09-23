import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Dispatcher, type ToolError } from './dispatch.js';

function asToolError(e: unknown): ToolError {
  if (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    'message' in e &&
    typeof (e as { code: unknown }).code === 'string' &&
    typeof (e as { message: unknown }).message === 'string'
  ) {
    return e as ToolError;
  }
  return {
    code: 'INTERNAL_ERROR',
    message: e instanceof Error ? e.message : String(e),
  };
}

type InputSchema = { type: 'object'; [k: string]: unknown };

/** ListTools payload: each tool's zod schema as JSON Schema (input side, so defaulted fields stay optional). */
export function listTools(dispatcher: Dispatcher): {
  name: string;
  description: string;
  inputSchema: InputSchema;
}[] {
  return dispatcher.list().map((t) => {
    const { $schema: _drop, ...json } = z.toJSONSchema(t.schema, { io: 'input' }) as Record<
      string,
      unknown
    >;
    return {
      name: t.name,
      description: t.description ?? '',
      inputSchema: { ...json, type: 'object' as const },
    };
  });
}

export async function startServer(dispatcher: Dispatcher): Promise<void> {
  const server = new Server(
    { name: 'walrus-agent-stack-mcp', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listTools(dispatcher),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const result = await dispatcher.invoke(
        req.params.name,
        req.params.arguments ?? {},
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    } catch (e: unknown) {
      const err = asToolError(e);
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              code: err.code,
              message: err.message,
              details: err.details,
            }),
          },
        ],
      };
    }
  });

  await server.connect(new StdioServerTransport());
}
