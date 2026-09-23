import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getActiveChannel,
  getCursor,
  readSession,
  resolveChannelId,
  sessionFile,
  setActiveChannel,
  setCursor,
} from '../../src/session.js';

describe('session', () => {
  let home: string;
  beforeEach(() => {
    home = join(mkdtempSync(join(tmpdir(), 'wa-sess-')), 'was');
  });

  it('starts empty when session.json is missing', () => {
    expect(readSession(home)).toEqual({ cursors: {} });
    expect(getActiveChannel(home)).toBeUndefined();
    expect(getCursor(home, 'c')).toBeUndefined();
  });

  it('persists active channel and cursors (null = from the start)', () => {
    setActiveChannel(home, 'chan-1');
    setCursor(home, 'chan-1', null);
    setCursor(home, 'chan-2', 7);
    expect(getActiveChannel(home)).toBe('chan-1');
    expect(getCursor(home, 'chan-1')).toBeNull();
    expect(getCursor(home, 'chan-2')).toBe(7);
    expect(JSON.parse(readFileSync(sessionFile(home), 'utf-8'))).toEqual({
      active_channel_id: 'chan-1',
      cursors: { 'chan-1': null, 'chan-2': 7 },
    });
    // Atomic write leaves no tmp file behind.
    expect(readdirSync(home)).toEqual(['session.json']);
  });

  it('tolerates a legacy {} session file', () => {
    setActiveChannel(home, 'x'); // creates dir
    writeFileSync(sessionFile(home), '{}\n');
    expect(readSession(home)).toEqual({ cursors: {} });
  });

  it('resolveChannelId: explicit > active > NO_ACTIVE_CHANNEL', () => {
    expect(() => resolveChannelId(home, undefined)).toThrow(
      expect.objectContaining({ code: 'NO_ACTIVE_CHANNEL' }),
    );
    setActiveChannel(home, 'active');
    expect(resolveChannelId(home, undefined)).toBe('active');
    expect(resolveChannelId(home, 'explicit')).toBe('explicit');
  });
});
