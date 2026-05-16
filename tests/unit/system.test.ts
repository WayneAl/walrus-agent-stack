import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolLog, type LogEntry } from '../../src/logging.js';
import { debugTool } from '../../src/tools/system.js';

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
