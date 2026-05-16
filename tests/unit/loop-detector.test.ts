import { describe, it, expect } from 'vitest';
import { LoopDetector } from '../../src/loop-detector.js';

describe('LoopDetector', () => {
  it('triggers after 5 same-sender messages in a row', () => {
    const ld = new LoopDetector(5);
    for (let i = 0; i < 4; i++) expect(ld.observe('alice')).toBe(false);
    expect(ld.observe('alice')).toBe(true);
  });

  it('different sender breaks the streak', () => {
    const ld = new LoopDetector(5);
    for (let i = 0; i < 4; i++) ld.observe('alice');
    ld.observe('bob');
    expect(ld.observe('alice')).toBe(false);
  });

  it('user input reset wipes counters', () => {
    const ld = new LoopDetector(5);
    for (let i = 0; i < 4; i++) ld.observe('alice');
    ld.reset();
    expect(ld.observe('alice')).toBe(false);
  });
});
