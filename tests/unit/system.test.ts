import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { ToolLog, type LogEntry } from '../../src/logging.js';
import { debugTool, resendTool, healthTool } from '../../src/tools/system.js';
import { Outbox } from '../../src/outbox.js';
import type { Dispatcher } from '../../src/mcp/dispatch.js';
import type { SdkContext } from '../../src/sdk-client.js';

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

interface HealthResult {
  status: 'ok' | 'degraded';
  address: string;
  checks: Record<string, { ok: boolean; detail?: string }>;
}

function buildSdkStub(getBalance: (opts: { owner: string }) => Promise<unknown>): {
  sdk: SdkContext;
  keypair: Ed25519Keypair;
} {
  const keypair = Ed25519Keypair.generate();
  const sdk = {
    keypair,
    config: {
      relayerUrl: 'https://relayer.test.example.com',
    },
    client: {
      core: { getBalance },
    },
  } as unknown as SdkContext;
  return { sdk, keypair };
}

function fakeResponse(ok: boolean, status: number): Response {
  return { ok, status } as unknown as Response;
}

describe('system.health tool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct name and non-empty description', () => {
    const { sdk } = buildSdkStub(async () => ({
      balance: { coinType: '0x2::sui::SUI', balance: '0', coinBalance: '0' },
    }));
    const tool = healthTool(sdk);
    expect(tool.name).toBe('system.health');
    expect(typeof tool.description).toBe('string');
    expect((tool.description ?? '').length).toBeGreaterThan(0);
  });

  it('returns status ok with all probes green and the keypair address', async () => {
    const { sdk, keypair } = buildSdkStub(async () => ({
      balance: { coinType: '0x2::sui::SUI', balance: '12345', coinBalance: '12345' },
    }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse(true, 200));

    const tool = healthTool(sdk);
    const res = (await tool.handler({})) as HealthResult;

    expect(res.status).toBe('ok');
    expect(res.address).toBe(keypair.toSuiAddress());
    expect(res.checks.rpc!.ok).toBe(true);
    expect(res.checks.rpc!.detail).toContain('12345');
    expect(res.checks.relayer!.ok).toBe(true);
    expect(res.checks.walrus!.ok).toBe(true);
    expect(res.checks.seal!.ok).toBe(true);
  });

  it('marks rpc failure as degraded while relayer can still be ok', async () => {
    const { sdk } = buildSdkStub(async () => {
      throw new Error('grpc unreachable');
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse(true, 200));

    const tool = healthTool(sdk);
    const res = (await tool.handler({})) as HealthResult;

    expect(res.status).toBe('degraded');
    expect(res.checks.rpc!.ok).toBe(false);
    expect(res.checks.rpc!.detail).toContain('grpc unreachable');
    expect(res.checks.relayer!.ok).toBe(true);
  });

  it('cascades relayer failure into walrus and seal probes', async () => {
    const { sdk } = buildSdkStub(async () => ({
      balance: { coinType: '0x2::sui::SUI', balance: '7', coinBalance: '7' },
    }));
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('relayer offline'));

    const tool = healthTool(sdk);
    const res = (await tool.handler({})) as HealthResult;

    expect(res.status).toBe('degraded');
    expect(res.checks.relayer!.ok).toBe(false);
    expect(res.checks.relayer!.detail).toContain('relayer offline');
    expect(res.checks.walrus!.ok).toBe(false);
    expect(res.checks.seal!.ok).toBe(false);
  });
});
