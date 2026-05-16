import type { ZodType } from 'zod';
import type { ToolLog } from '../logging.js';

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

  constructor(private log?: ToolLog) {}

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
    const start = Date.now();
    let errorCode: string | null = null;
    try {
      const tool = this.tools.get(name);
      if (!tool) {
        errorCode = 'UNKNOWN_TOOL';
        const err: ToolError = {
          code: 'UNKNOWN_TOOL',
          message: `Unknown tool: ${name}`,
        };
        throw err;
      }
      const parsed = tool.schema.safeParse(args);
      if (!parsed.success) {
        errorCode = 'INVALID_ARGS';
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
        if (isToolError(e)) {
          errorCode = e.code;
          throw e;
        }
        errorCode = 'INTERNAL_ERROR';
        const err: ToolError = {
          code: 'INTERNAL_ERROR',
          message: e instanceof Error ? e.message : String(e),
        };
        throw err;
      }
    } catch (e: unknown) {
      if (!errorCode) {
        errorCode =
          (typeof e === 'object' && e !== null && 'code' in e
            ? String((e as { code: unknown }).code)
            : null) ?? 'INTERNAL_ERROR';
      }
      throw e;
    } finally {
      if (this.log) {
        this.log.record({
          tool: name,
          durationMs: Date.now() - start,
          errorCode,
          inputHash: this.log.inputHash(args),
        });
      }
    }
  }
}
