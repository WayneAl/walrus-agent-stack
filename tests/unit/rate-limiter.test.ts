import { describe, it, expect, vi } from 'vitest';
import { RateLimiter } from '../../src/rate-limiter.js';

describe('RateLimiter', () => {
  it('allows up to limit within window', () => {
    const rl = new RateLimiter(10, 60_000);
    for (let i = 0; i < 10; i++) expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(false);
  });

  it('different keys are independent', () => {
    const rl = new RateLimiter(2, 60_000);
    expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(false);
    expect(rl.check('b')).toBe(true);
  });

  it('window slides', () => {
    vi.useFakeTimers();
    const rl = new RateLimiter(2, 1000);
    expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(rl.check('a')).toBe(true);
    vi.useRealTimers();
  });
});
