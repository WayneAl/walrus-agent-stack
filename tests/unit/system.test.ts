import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { ToolLog, type LogEntry } from '../../src/logging.js';
import { debugTool, resendTool, healthTool, setupTool } from '../../src/tools/system.js';
import { Outbox } from '../../src/outbox.js';
import type { Dispatcher } from '../../src/mcp/dispatch.js';
import type { SdkContext } from '../../src/sdk-client.js';

describe('system_debug tool', () => {
  it('has correct name and non-empty description', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wa-sysdbg-'));
    const log = new ToolLog(dir);
    const tool = debugTool(log);
    expect(tool.name).toBe('system_debug');
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

describe('system_resend tool', () => {
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
    expect(tool.name).toBe('system_resend');
    expect(tool.description).toBeTruthy();
  });
});

interface HealthResult {
  status: 'ok' | 'degraded';
  address: string;
  checks: Record<string, { ok: boolean; detail?: string }>;
}

function buildSdkStub(
  getBalance: (opts: { owner: string }) => Promise<unknown>,
  config: Record<string, unknown> = { relayerUrl: 'https://relayer.test.example.com' },
): {
  sdk: SdkContext;
  keypair: Ed25519Keypair;
} {
  const keypair = Ed25519Keypair.generate();
  const sdk = {
    keypair,
    config,
    client: {
      core: { getBalance },
    },
  } as unknown as SdkContext;
  return { sdk, keypair };
}

function fakeResponse(ok: boolean, status: number): Response {
  return { ok, status } as unknown as Response;
}

describe('system_health tool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct name and non-empty description', () => {
    const { sdk } = buildSdkStub(async () => ({
      balance: { coinType: '0x2::sui::SUI', balance: '0', coinBalance: '0' },
    }));
    const tool = healthTool(sdk);
    expect(tool.name).toBe('system_health');
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
    expect(vi.mocked(globalThis.fetch).mock.calls[0]![0]).toBe(
      'https://relayer.test.example.com/health_check',
    );
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

const SERVERLESS_CONFIG = {
  network: 'testnet',
  walrusAggregatorUrl: 'https://aggregator.test',
  sealServers: ['0xs1', '0xs2'],
};

describe('system_health tool (serverless)', () => {
  it('probes rpc + Walrus aggregator and reports the relayer as serverless', async () => {
    const { sdk } = buildSdkStub(
      async () => ({ balance: { balance: '5' } }),
      SERVERLESS_CONFIG,
    );
    const fetchImpl = vi.fn(async () => fakeResponse(false, 404));
    const res = (await healthTool(sdk, fetchImpl).handler({})) as HealthResult;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe('https://aggregator.test');
    expect(res.checks.relayer).toEqual({ ok: true, detail: 'serverless (Sui + Walrus)' });
    // Any HTTP answer means the aggregator is reachable.
    expect(res.checks.walrus!.ok).toBe(true);
    expect(res.checks.seal!.ok).toBe(true);
    expect(res.status).toBe('ok');
  });

  it('marks walrus down when the aggregator is unreachable', async () => {
    const { sdk } = buildSdkStub(async () => ({ balance: { balance: '5' } }), SERVERLESS_CONFIG);
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const res = (await healthTool(sdk, fetchImpl).handler({})) as HealthResult;
    expect(res.checks.walrus!.ok).toBe(false);
    expect(res.status).toBe('degraded');
  });
});

interface SetupResult {
  address: string;
  network: string;
  balance_sui: number;
  funded: boolean;
  faucet?: { ok: boolean; endpoint?: string; status?: number };
  web_faucet: string;
  next_steps: string;
}

describe('system_setup tool', () => {
  it('skips the faucet when already funded', async () => {
    const { sdk, keypair } = buildSdkStub(
      async () => ({ balance: { balance: '1000000000' } }),
      SERVERLESS_CONFIG,
    );
    const fetchImpl = vi.fn();
    const tool = setupTool(sdk, fetchImpl);
    expect(tool.name).toBe('system_setup');
    const res = (await tool.handler({})) as SetupResult;
    const address = keypair.toSuiAddress();
    expect(res).toMatchObject({
      address,
      network: 'testnet',
      balance_sui: 1,
      funded: true,
      web_faucet: `https://faucet.sui.io/?address=${address}`,
    });
    expect(res.faucet).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back from faucet v2 (404) to v1 and re-reads the balance', async () => {
    const balances = ['0', '10000000000'];
    const { sdk, keypair } = buildSdkStub(
      async () => ({ balance: { balance: balances.shift() } }),
      SERVERLESS_CONFIG,
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'nope' })
      .mockResolvedValueOnce({ ok: true, status: 201 });
    const res = (await setupTool(sdk, fetchImpl).handler({})) as SetupResult;
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      'https://faucet.testnet.sui.io/v2/gas',
      'https://faucet.testnet.sui.io/gas',
    ]);
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      FixedAmountRequest: { recipient: keypair.toSuiAddress() },
    });
    expect(res.faucet).toMatchObject({ ok: true, endpoint: 'https://faucet.testnet.sui.io/gas' });
    expect(res.funded).toBe(true);
    expect(res.balance_sui).toBe(10);
  });

  it('reports a rate-limited faucet and points at the web faucet', async () => {
    const { sdk } = buildSdkStub(async () => ({ balance: { balance: '0' } }), SERVERLESS_CONFIG);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 429, text: async () => 'Too many requests' });
    const res = (await setupTool(sdk, fetchImpl).handler({})) as SetupResult;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res.funded).toBe(false);
    expect(res.faucet).toMatchObject({ ok: false, status: 429 });
    expect(res.next_steps).toContain(res.web_faucet);
  });

  it('never calls the faucet on mainnet', async () => {
    const { sdk } = buildSdkStub(async () => ({ balance: { balance: '0' } }), {
      ...SERVERLESS_CONFIG,
      network: 'mainnet',
    });
    const fetchImpl = vi.fn();
    const res = (await setupTool(sdk, fetchImpl).handler({})) as SetupResult;
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(res.funded).toBe(false);
  });
});
