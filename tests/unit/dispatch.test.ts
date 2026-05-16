import { describe, it, expect } from 'vitest';
import { Dispatcher } from '../../src/mcp/dispatch.js';
import { z } from 'zod';

describe('Dispatcher', () => {
  it('routes tool call to registered handler', async () => {
    const d = new Dispatcher();
    d.register({
      name: 'echo',
      schema: z.object({ msg: z.string() }),
      handler: async ({ msg }) => ({ ok: true, msg }),
    });
    const res = await d.invoke('echo', { msg: 'hi' });
    expect(res).toEqual({ ok: true, msg: 'hi' });
  });

  it('returns structured error on unknown tool', async () => {
    const d = new Dispatcher();
    await expect(d.invoke('missing', {})).rejects.toMatchObject({
      code: 'UNKNOWN_TOOL',
    });
  });

  it('returns validation error on bad args', async () => {
    const d = new Dispatcher();
    d.register({
      name: 'echo',
      schema: z.object({ msg: z.string() }),
      handler: async ({ msg }) => ({ msg }),
    });
    await expect(d.invoke('echo', { msg: 123 })).rejects.toMatchObject({
      code: 'INVALID_ARGS',
    });
  });
});
