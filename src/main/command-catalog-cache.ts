type PublishListener<T> = (value: T) => void | Promise<void>;

interface CommandCatalogCacheOptions<T> {
  discover: () => Promise<T>;
  ttlMs: number;
  staleRefreshCooldownMs: number;
  now?: () => number;
}

/** Owns freshness and publication; discovery itself must not publish its result. */
export function createCommandCatalogCache<T>({
  discover,
  ttlMs,
  staleRefreshCooldownMs,
  now = Date.now,
}: CommandCatalogCacheOptions<T>) {
  let generation = 0;
  let snapshot: { value: T; generation: number; publishedAt: number } | null = null;
  let inflight: Promise<T> | null = null;
  let lastBackgroundRefreshAt = -Infinity;
  const listeners = new Set<PublishListener<T>>();

  function notify(value: T): void {
    for (const listener of [...listeners]) {
      try {
        // Subscribers do not own cache validity. Isolate both synchronous throws
        // and asynchronous rejections, and still notify the remaining listeners.
        void Promise.resolve(listener(value)).catch((error) => {
          console.warn('[Commands] Publication listener failed:', error);
        });
      } catch (error) {
        console.warn('[Commands] Publication listener failed:', error);
      }
    }
  }

  /** Force discovery, or join the worker until it publishes a valid generation. */
  function refresh(): Promise<T> {
    if (!inflight) {
      // Defer entry so even a synchronous discovery failure sees the assigned
      // promise. Only one scan runs at a time, including obsolete scans.
      inflight = Promise.resolve().then(async () => {
        try {
          for (;;) {
            const startedGeneration = generation;
            let value: T;
            try {
              value = await discover();
            } catch (error) {
              // An invalidation during a failed scan still needs its own scan.
              if (startedGeneration !== generation) continue;
              throw error;
            }
            if (startedGeneration !== generation) continue;

            snapshot = { value, generation: startedGeneration, publishedAt: now() };
            notify(value);
            // A subscriber may invalidate synchronously while being notified.
            if (startedGeneration === generation) return value;
          }
        } finally {
          // Clear in the worker's completion turn, not in a later .finally()
          // reaction that could swallow a newly requested refresh.
          inflight = null;
        }
      });
    }
    return inflight;
  }

  return {
    /** Disk snapshots are usable immediately, but never inherit a fresh TTL. */
    seedStale(value: T): void {
      if (!snapshot) snapshot = { value, generation: -1, publishedAt: -Infinity };
    },

    async read(): Promise<T> {
      if (!snapshot) return refresh();
      const isFresh = snapshot.generation === generation && now() - snapshot.publishedAt < ttlMs;
      if (!isFresh && !inflight && now() - lastBackgroundRefreshAt >= staleRefreshCooldownMs) {
        lastBackgroundRefreshAt = now();
        void refresh().catch((error) => {
          console.warn('[Commands] Background refresh failed:', error);
        });
      }
      return snapshot.value;
    },

    refresh,

    /** Retain fallback data, but retire any scan started before this mutation. */
    invalidate(): void {
      generation += 1;
      lastBackgroundRefreshAt = -Infinity;
    },

    subscribe(listener: PublishListener<T>): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
