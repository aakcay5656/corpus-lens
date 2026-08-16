import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createIngestionScheduler } from "./ingestion-scheduler";

/**
 * Fake timers throughout. The two rules under test are about *when* things happen, and
 * testing them by actually waiting would make the suite slow and flaky in exchange for
 * nothing — the scheduler has no filesystem and no database precisely so this is possible.
 */
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A run that resolves when told to, so overlap can be arranged deterministically. */
function controllableRun() {
  const calls: string[] = [];
  let release: (() => void) | undefined;

  const run = (trigger: string): Promise<void> => {
    calls.push(trigger);
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  };

  return {
    calls,
    run,
    finish: async (): Promise<void> => {
      release?.();
      release = undefined;
      // Lets the scheduler's own `await` continue before the test asserts.
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

describe("createIngestionScheduler", () => {
  it("collapses a burst of changes into one run", async () => {
    const calls: string[] = [];
    const scheduler = createIngestionScheduler({
      run: (trigger) => {
        calls.push(trigger);
        return Promise.resolve();
      },
      debounceMs: 100,
    });

    // One editor save produces several events: a temp file, a rename, a chmod.
    scheduler.notify();
    scheduler.notify();
    scheduler.notify();

    await vi.advanceTimersByTimeAsync(150);

    expect(calls).toEqual(["WATCH"]);
  });

  it("does not run until the changes stop", async () => {
    const calls: string[] = [];
    const scheduler = createIngestionScheduler({
      run: () => {
        calls.push("run");
        return Promise.resolve();
      },
      debounceMs: 100,
    });

    scheduler.notify();
    await vi.advanceTimersByTimeAsync(80);
    scheduler.notify(); // resets the quiet period
    await vi.advanceTimersByTimeAsync(80);

    expect(calls).toEqual([]);

    await vi.advanceTimersByTimeAsync(40);
    expect(calls).toEqual(["run"]);
  });

  /**
   * The rule that matters most. Ingestion replaces a document's chunks wholesale, so two
   * concurrent runs would interleave deletes and inserts on the same rows.
   */
  it("never runs two ingestions at once", async () => {
    const controller = controllableRun();
    const scheduler = createIngestionScheduler({ run: controller.run, debounceMs: 10 });

    scheduler.notify();
    await vi.advanceTimersByTimeAsync(20);
    expect(controller.calls).toHaveLength(1);

    // A change arrives mid-run.
    scheduler.notify();
    await vi.advanceTimersByTimeAsync(20);
    expect(controller.calls).toHaveLength(1);

    await controller.finish();
    expect(controller.calls).toHaveLength(2);
  });

  it("queues at most one follow-up run, not one per change", async () => {
    const controller = controllableRun();
    const scheduler = createIngestionScheduler({ run: controller.run, debounceMs: 10 });

    scheduler.notify();
    await vi.advanceTimersByTimeAsync(20);

    // Five bursts during the run. The corpus is re-classified from scratch each pass, so
    // one follow-up covers all of them — queueing five would re-hash the corpus five times
    // for no additional information.
    for (let i = 0; i < 5; i += 1) {
      scheduler.notify();
      await vi.advanceTimersByTimeAsync(20);
    }

    await controller.finish();
    expect(controller.calls).toHaveLength(2);

    await controller.finish();
    expect(controller.calls).toHaveLength(2);
  });

  it("keeps watching after a run throws", async () => {
    const errors: unknown[] = [];
    let attempt = 0;
    const scheduler = createIngestionScheduler({
      run: () => {
        attempt += 1;
        return attempt === 1 ? Promise.reject(new Error("boom")) : Promise.resolve();
      },
      debounceMs: 10,
      onError: (error) => errors.push(error),
    });

    scheduler.notify();
    await vi.advanceTimersByTimeAsync(20);
    expect(errors).toHaveLength(1);

    // A failed run must not kill the watcher: the next change still triggers one.
    scheduler.notify();
    await vi.advanceTimersByTimeAsync(20);
    expect(attempt).toBe(2);
  });

  it("runs on the interval as well, tagged SCHEDULE", async () => {
    const calls: string[] = [];
    const scheduler = createIngestionScheduler({
      run: (trigger) => {
        calls.push(trigger);
        return Promise.resolve();
      },
      debounceMs: 10,
    });

    scheduler.startInterval(1000);
    await vi.advanceTimersByTimeAsync(2500);

    // Tagged distinctly from WATCH so the dashboard can tell an automatic re-index from a
    // change-driven one.
    expect(calls).toEqual(["SCHEDULE", "SCHEDULE"]);
    await scheduler.stop();
  });

  it("stops cleanly, ignoring changes that arrive after", async () => {
    const calls: string[] = [];
    const scheduler = createIngestionScheduler({
      run: () => {
        calls.push("run");
        return Promise.resolve();
      },
      debounceMs: 10,
    });

    scheduler.startInterval(1000);
    await scheduler.stop();

    scheduler.notify();
    await vi.advanceTimersByTimeAsync(3000);

    expect(calls).toEqual([]);
  });

  it("waits for an in-flight run before stopping", async () => {
    const controller = controllableRun();
    const scheduler = createIngestionScheduler({ run: controller.run, debounceMs: 10 });

    scheduler.notify();
    await vi.advanceTimersByTimeAsync(20);

    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });

    await vi.advanceTimersByTimeAsync(50);
    // Still waiting: abandoning here would leave the run row stuck at RUNNING forever.
    expect(stopped).toBe(false);

    await controller.finish();
    await stopping;
    expect(stopped).toBe(true);
  });
});
