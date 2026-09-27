import { ApiFailure } from "./errors";

/**
 * Fixed-window limiter for brute-force-sensitive endpoints (PIN switch,
 * approvals). In-process is enough for a single instance; swap for Redis when
 * running many instances (same interface).
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): void {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) this.sweep(now);
      return;
    }
    entry.count += 1;
    if (entry.count > this.limit) throw new ApiFailure("RATE_LIMITED", 429, { retry_after_s: Math.ceil((entry.resetAt - now) / 1000) });
  }

  private sweep(now: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
