export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private maxPerWindow: number,
    private windowMs: number,
  ) {}

  check(key: string): boolean {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.maxPerWindow) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }

  reset(): void {
    this.hits.clear();
  }
}
