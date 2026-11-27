/**
 * Small TTL + LRU cache for immutable-ish metadata.
 *
 * Use this only for data that is safe to be briefly stale: mime types, sheet
 * name → ID maps, titles. Never cache document/presentation content or
 * `revisionId` — edits must be planned against fresh state.
 *
 * One instance per service (and, once multi-user support lands, one per
 * authenticated user) so cached metadata can never leak across accounts.
 */

interface CacheEntry<T> {
  value: T;
  /** Epoch millis; 0 means the entry never expires. */
  expiresAt: number;
}

export interface MetadataCacheOptions {
  /** Time-to-live in milliseconds. 0 disables expiry (default: 60s). */
  ttlMs?: number;
  /** Maximum entries before the least-recently-used one is evicted (default: 500). */
  maxEntries?: number;
}

export class MetadataCache<T> {
  private entries = new Map<string, CacheEntry<T>>();
  private inFlight = new Map<string, Promise<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: MetadataCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 60_000;
    this.maxEntries = Math.max(1, options.maxEntries ?? 500);
  }

  /**
   * Return the cached value, or run `loader` once and cache the result.
   *
   * Concurrent misses for the same key share a single loader promise, so
   * parallel tool calls do not duplicate API requests. Failed loads are never
   * cached; the next call retries.
   */
  async get(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.peekEntry(key);
    if (cached) {
      return cached.value;
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      return pending;
    }

    const promise = loader()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  /** Read without loading. Returns undefined when absent or expired. */
  peek(key: string): T | undefined {
    return this.peekEntry(key)?.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);

    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }

    this.entries.set(key, {
      value,
      expiresAt: this.ttlMs > 0 ? Date.now() + this.ttlMs : 0,
    });
  }

  delete(key: string): void {
    this.entries.delete(key);
    this.inFlight.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private peekEntry(key: string): CacheEntry<T> | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt !== 0 && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    // Refresh LRU position.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }
}
