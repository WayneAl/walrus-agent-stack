import type { ZodType } from 'zod';

export interface ToolError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ToolDef<T> {
  name: string;
  schema: ZodType<T>;
  handler: (args: T) => Promise<unknown>;
  description?: string;
}

function isToolError(e: unknown): e is ToolError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    'message' in e &&
    typeof (e as { code: unknown }).code === 'string' &&
    typeof (e as { message: unknown }).message === 'string'
  );
}

export class Dispatcher {
  private tools = new Map<string, ToolDef<unknown>>();

  register<T>(def: ToolDef<T>): void {
    this.tools.set(def.name, def as unknown as ToolDef<unknown>);
  }

  list(): { name: string; description?: string }[] {
    return Array.from(this.tools.values()).map(({ name, description }) => ({
      name,
      description,
    }));
  }

  async invoke(name: string, args: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      const err: ToolError = {
        code: 'UNKNOWN_TOOL',
        message: `Unknown tool: ${name}`,
      };
      throw err;
    }
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) {
      const err: ToolError = {
        code: 'INVALID_ARGS',
        message: 'Argument validation failed',
        details: parsed.error.flatten(),
      };
      throw err;
    }
    try {
      return await tool.handler(parsed.data);
    } catch (e: unknown) {
      if (isToolError(e)) throw e;
      const err: ToolError = {
        code: 'INTERNAL_ERROR',
        message: e instanceof Error ? e.message : String(e),
      };
      throw err;
    }
  }
}
