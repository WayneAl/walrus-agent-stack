import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolLog, type LogEntry } from '../../src/logging.js';
import { debugTool, resendTool } from '../../src/tools/system.js';
import { Outbox } from '../../src/outbox.js';
import type { Dispatcher } from '../../src/mcp/dispatch.js';

describe('system.debug tool', () => {
  it('has correct name and non-empty description', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wa-sysdbg-'));
    const log = new ToolLog(dir);
    const tool = debugTool(log);
    expect(tool.name).toBe('system.debug');
    expect(typeof tool.description).toBe('string');
    expect((tool.description ?? '').length).toBeGreaterThan(0);
  });

  it('returns the most recent N entries in reverse order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wa-sysdbg-'));
    const log = new ToolLog(dir);
    log.record({ tool: 'a', durationMs: 1, errorCode: null, inputHash: 'ha' });
    log.record({ tool: 'b', durationMs: 2, errorCode: null, inputHash: 'hb' });
    log.record({ tool: 'c', durationMs: 3, errorCode: 'INVALID_ARGS', inputHash: 'hc' });

    const tool = debugTool(log);
    const result = (await tool.handler({ limit: 2 })) as { entries: LogEntry[] };
    expect(result.entries.length).toBe(2);
    expect(result.entries[0]!.tool).toBe('c');
    expect(result.entries[1]!.tool).toBe('b');
    expect(result.entries[0]!.errorCode).toBe('INVALID_ARGS');
  });
});

interface ResendResult {
  id: string;
  status: 'sent' | 'failed';
  result?: unknown;
  error?: unknown;
}

describe('system.resend tool', () => {
  it('replays each pending item via the dispatcher; sent items leave the outbox, failed remain', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wa-resend-'));
    const outbox = new Outbox(dir);
    outbox.enqueue({ id: 'item-1', tool: 'channel.send', args: { channel_id: 'c', content: 'a' } });
    outbox.enqueue({ id: 'item-2', tool: 'channel.send', args: { channel_id: 'c', content: 'b' } });

    const invoke = vi
      .fn()
      .mockImplementationOnce(async () => ({ ok: true, which: 'item-1' }))
      .mockImplementationOnce(async () => {
        throw { code: 'RELAYER_UNREACHABLE', message: 'still down' };
      });
    const dispatcher = { invoke } as unknown as Dispatcher;

    const tool = resendTool(outbox, dispatcher);
    const res = (await tool.handler({})) as { processed: ResendResult[] };

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(res.processed).toHaveLength(2);
    expect(res.processed[0]!.id).toBe('item-1');
    expect(res.processed[0]!.status).toBe('sent');
    expect(res.processed[0]!.result).toEqual({ ok: true, which: 'item-1' });
    expect(res.processed[1]!.id).toBe('item-2');
    expect(res.processed[1]!.status).toBe('failed');
    expect(res.processed[1]!.error).toMatchObject({ code: 'RELAYER_UNREACHABLE' });

    const remaining = outbox.pending();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe('item-2');
    // The failed item's attempt counter incremented before invoke.
    expect(remaining[0]!.attempts).toBe(1);
  });

  it('exposes the right tool name and description', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wa-resend-meta-'));
    const outbox = new Outbox(dir);
    const dispatcher = { invoke: vi.fn() } as unknown as Dispatcher;
    const tool = resendTool(outbox, dispatcher);
    expect(tool.name).toBe('system.resend');
    expect(tool.description).toBeTruthy();
  });
});
