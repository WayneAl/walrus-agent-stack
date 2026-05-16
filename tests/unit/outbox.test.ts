import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Outbox } from '../../src/outbox.js';

describe('Outbox', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'outbox-'));
  });

  it('persists and lists pending', () => {
    const ob = new Outbox(dir);
    ob.enqueue({ id: 'm1', tool: 'channel.send', args: { channel_id: 'c', content: 'hi' } });
    ob.enqueue({ id: 'm2', tool: 'channel.send', args: { channel_id: 'c', content: 'bye' } });
    expect(ob.pending()).toHaveLength(2);
  });

  it('marks complete and drops from pending', () => {
    const ob = new Outbox(dir);
    ob.enqueue({ id: 'm1', tool: 'channel.send', args: {} });
    ob.markDone('m1');
    expect(ob.pending()).toHaveLength(0);
  });

  it('persists across instances', () => {
    new Outbox(dir).enqueue({ id: 'm1', tool: 'x', args: {} });
    expect(new Outbox(dir).pending()).toHaveLength(1);
  });
});
