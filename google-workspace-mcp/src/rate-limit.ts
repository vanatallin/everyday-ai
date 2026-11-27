/**
 * Fixed-window rate limiting per identity.
 *
 * Intentionally simple and in-memory; good enough to stop one user from
 * monopolising a single server instance. A shared limiter can replace this
 * when the server is scaled horizontally.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets (only set when blocked). */
  retryAfter?: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000
  ) {}

  /** 0 (or negative) disables limiting. */
  check(key: string, now: number = Date.now()): RateLimitResult {
    if (this.limit <= 0) {
      return { allowed: true };
    }

    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true };
    }

    if (existing.count >= this.limit) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      };
    }

    existing.count += 1;
    return { allowed: true };
  }

  /** Drop expired windows so a long-running process does not grow unbounded. */
  prune(now: number = Date.now()): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) {
        this.windows.delete(key);
      }
    }
  }

  reset(): void {
    this.windows.clear();
  }

  get size(): number {
    return this.windows.size;
  }
}
