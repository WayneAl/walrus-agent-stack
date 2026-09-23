import { describe, it, expect } from 'vitest';
import { Dispatcher } from '../../src/mcp/dispatch.js';
import { listTools } from '../../src/mcp/server.js';
import { mapSdkError } from '../../src/errors.js';
import { ChannelSendArgs, ChannelWaitArgs, EmptyArgs } from '../../src/schemas.js';
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

  it('accepts the legacy dotted name for an underscore tool', async () => {
    const d = new Dispatcher();
    d.register({
      name: 'channel_send',
      schema: z.object({ content: z.string() }),
      handler: async ({ content }) => ({ content }),
    });
    await expect(d.invoke('channel.send', { content: 'hi' })).resolves.toEqual({ content: 'hi' });
    await expect(d.invoke('channel_send', { content: 'hi' })).resolves.toEqual({ content: 'hi' });
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

  it('maps transport errors via the error mapper', async () => {
    const ctx = { address: '0xabc', network: 'testnet' as const };
    const d = new Dispatcher(undefined, (e) => mapSdkError(e, ctx));
    const failWith = (err: unknown) => async () => {
      throw err;
    };
    d.register({ name: 'a', schema: EmptyArgs, handler: failWith(Object.assign(new Error('x'), { status: 403 })) });
    d.register({ name: 'b', schema: EmptyArgs, handler: failWith(Object.assign(new Error('x'), { status: 402 })) });
    d.register({ name: 'c', schema: EmptyArgs, handler: failWith(new Error('InsufficientGas in tx')) });
    d.register({ name: 'd', schema: EmptyArgs, handler: failWith(new Error('other')) });
    await expect(d.invoke('a', {})).rejects.toMatchObject({ code: 'NOT_GROUP_MEMBER' });
    const gas = d.invoke('b', {});
    await expect(gas).rejects.toMatchObject({ code: 'INSUFFICIENT_GAS' });
    await expect(gas).rejects.toMatchObject({
      message: expect.stringContaining('https://faucet.sui.io/?address=0xabc'),
    });
    await expect(d.invoke('c', {})).rejects.toMatchObject({ code: 'INSUFFICIENT_GAS' });
    await expect(d.invoke('d', {})).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});

describe('listTools (MCP ListTools payload)', () => {
  it('exposes each zod schema as an object JSON Schema without $schema', () => {
    const d = new Dispatcher();
    d.register({ name: 'channel_send', description: 'send', schema: ChannelSendArgs, handler: async () => null });
    d.register({ name: 'channel_wait', description: 'wait', schema: ChannelWaitArgs, handler: async () => null });
    d.register({ name: 'identity_whoami', description: 'who', schema: EmptyArgs, handler: async () => null });
    const tools = listTools(d);
    expect(tools.map((t) => t.name)).toEqual(['channel_send', 'channel_wait', 'identity_whoami']);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.inputSchema).not.toHaveProperty('$schema');
    }
    const send = tools[0]!.inputSchema as unknown as {
      properties: Record<string, { enum?: string[] }>;
      required?: string[];
    };
    expect(Object.keys(send.properties)).toEqual(
      expect.arrayContaining(['channel_id', 'content', 'to', 'intent', 'refs']),
    );
    expect(send.required).toEqual(['content']);
    expect(send.properties.intent!.enum).toEqual(['task', 'result', 'chat', 'done']);
    // Defaulted fields stay optional for the caller.
    const wait = tools[1]!.inputSchema as unknown as { required?: string[] };
    expect(wait.required ?? []).toEqual([]);
  });
});
