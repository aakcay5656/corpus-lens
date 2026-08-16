/**
 * When to run an incremental ingestion, separated from what triggers it.
 *
 * This holds the two rules that make an automatic re-index safe, and it holds them apart
 * from chokidar so both can be tested with fake timers rather than with a real filesystem
 * and real waiting:
 *
 * 1. **Debounce.** Saving one file in an editor produces a burst of events — a temporary
 *    file, a rename, a chmod — and copying a directory produces hundreds. Running once per
 *    event would re-hash the corpus dozens of times for a single edit.
 *
 * 2. **Never overlap.** Ingestion replaces a document's chunks wholesale, so two runs over
 *    the same corpus would interleave deletes and inserts on the same rows. A change
 *    arriving mid-run is not dropped, though: it sets a flag, and one more run starts when
 *    the current one finishes. Dropping it would leave the index stale until the next
 *    unrelated edit.
 */

export interface IngestionSchedulerOptions {
  /** Performs one incremental pass. Must not throw — errors are reported, not propagated. */
  run: (trigger: "WATCH" | "SCHEDULE") => Promise<void>;
  /** Quiet period after the last change before a run starts. */
  debounceMs?: number;
  onError?: (error: unknown) => void;
}

export interface IngestionScheduler {
  /** Called for every filesystem event. Cheap; the debounce does the work. */
  notify: () => void;
  /** Starts a periodic run in addition to change-driven ones. */
  startInterval: (intervalMs: number) => void;
  /** Waits for any in-flight run, then stops all timers. */
  stop: () => Promise<void>;
}

export const DEFAULT_DEBOUNCE_MS = 400;

export function createIngestionScheduler(options: IngestionSchedulerOptions): IngestionScheduler {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let intervalTimer: ReturnType<typeof setInterval> | undefined;
  let inFlight: Promise<void> | undefined;
  let queued: "WATCH" | "SCHEDULE" | undefined;
  let stopped = false;

  async function execute(trigger: "WATCH" | "SCHEDULE"): Promise<void> {
    if (inFlight !== undefined) {
      // A run is already going. Remember that another is needed rather than starting one
      // concurrently or discarding the change.
      queued = trigger;
      return;
    }

    inFlight = (async () => {
      try {
        await options.run(trigger);
      } catch (error) {
        // A failed run must not kill the watcher. The next change should still be picked
        // up, and the failure is already recorded on the run row by the pipeline.
        options.onError?.(error);
      }
    })();

    await inFlight;
    inFlight = undefined;

    const next = queued;
    queued = undefined;
    if (next !== undefined && !stopped) await execute(next);
  }

  return {
    notify: (): void => {
      if (stopped) return;
      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined;
        void execute("WATCH");
      }, debounceMs);
    },

    startInterval: (intervalMs: number): void => {
      intervalTimer = setInterval(() => {
        void execute("SCHEDULE");
      }, intervalMs);
    },

    stop: async (): Promise<void> => {
      stopped = true;
      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
      if (intervalTimer !== undefined) clearInterval(intervalTimer);
      // Awaited so a Ctrl-C during a run does not abandon a half-written document. The
      // pipeline writes each document in a transaction, so the database stays consistent
      // either way, but the run row would be left RUNNING forever.
      await inFlight;
    },
  };
}
