import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolLog } from '../../src/logging.js';

describe('ToolLog', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'walogs-'));
  });

  it('writes one jsonl line per call', () => {
    const log = new ToolLog(dir);
    log.record({ tool: 'channel.send', durationMs: 12, errorCode: null, inputHash: 'abc' });
    log.record({ tool: 'memory.write', durationMs: 50, errorCode: 'INVALID_ARGS', inputHash: 'def' });
    const file = log.todayFile();
    const lines = readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!).tool).toBe('channel.send');
    expect(JSON.parse(lines[1]!).errorCode).toBe('INVALID_ARGS');
  });

  it('hashes input deterministically', () => {
    const log = new ToolLog(dir);
    expect(log.inputHash({ a: 1 })).toBe(log.inputHash({ a: 1 }));
    expect(log.inputHash({ a: 1 })).not.toBe(log.inputHash({ a: 2 }));
  });

  it('tail returns recent entries in reverse order', () => {
    const log = new ToolLog(dir);
    for (let i = 0; i < 5; i++) {
      log.record({ tool: `t${i}`, durationMs: i, errorCode: null, inputHash: `h${i}` });
    }
    const recent = log.tail(3);
    expect(recent.length).toBe(3);
    expect(recent[0]!.tool).toBe('t4');
    expect(recent[2]!.tool).toBe('t2');
  });
});
