export interface BackgroundTask {
  id: string;
  intervalMs: number;
  /** Execution identity, distinct from presentation metadata such as title. */
  revision: string;
  run: (isCurrent: () => boolean) => Promise<void>;
}

interface SchedulerClock {
  setInterval: (tick: () => void, ms: number) => unknown;
  clearInterval: (timer: unknown) => void;
}

/** Owns due times and in-flight work; callers own execution and its effects. */
export function createBackgroundScheduler(
  onError: (error: unknown, id: string) => void,
  clock: SchedulerClock = {
    setInterval: (tick, ms) => setInterval(tick, ms),
    clearInterval: (timer) => clearInterval(timer as ReturnType<typeof setInterval>),
  },
) {
  const entries = new Map<string, { task: BackgroundTask; timer: unknown }>();
  // Survives removal/replacement until the old operation settles. A replacement
  // with the same id must not overlap an operation we cannot actually cancel.
  const running = new Set<string>();
  let disposed = false;

  const remove = (id: string) => {
    const entry = entries.get(id);
    if (entry) clock.clearInterval(entry.timer);
    entries.delete(id);
  };

  return {
    reconcile(tasks: BackgroundTask[]): void {
      if (disposed) return;
      const next = new Map(tasks.filter((task) => Number.isFinite(task.intervalMs) && task.intervalMs > 0)
        .map((task) => [task.id, task]));
      for (const [id, entry] of entries) {
        const task = next.get(id);
        if (!task || task.intervalMs !== entry.task.intervalMs || task.revision !== entry.task.revision) remove(id);
      }
      for (const [id, task] of next) {
        const existing = entries.get(id);
        if (existing) {
          existing.task = task; // New metadata and callbacks, unchanged due time.
          continue;
        }
        const entry = { task, timer: undefined as unknown };
        const isCurrent = () => !disposed && entries.get(id) === entry;
        entry.timer = clock.setInterval(() => {
          if (!isCurrent() || running.has(id)) return;
          running.add(id);
          void (async () => {
            try { await entry.task.run(isCurrent); }
            catch (error) {
              // Reporting must not leave a rejected timer callback behind.
              try { onError(error, id); } catch { /* reporter is best effort */ }
            } finally { running.delete(id); }
          })();
        }, task.intervalMs);
        entries.set(id, entry);
      }
    },

    dispose(): void {
      disposed = true;
      for (const id of entries.keys()) remove(id);
    },
  };
}
