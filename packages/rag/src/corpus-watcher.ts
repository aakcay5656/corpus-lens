import chokidar, { type FSWatcher } from "chokidar";

/**
 * Watches a corpus directory for changes.
 *
 * Deliberately thin: it reports *that* something changed, not what. The ingestion pipeline
 * already classifies every document as new, changed, unchanged or removed by comparing
 * content hashes, and a full incremental pass over this corpus costs about a tenth of a
 * second because unchanged documents are skipped without being re-embedded.
 *
 * Passing the changed path through and ingesting only that file would be faster in theory
 * and wrong in several practical cases — a rename is a delete plus a create, an editor's
 * atomic save is a temp file plus a rename, and a `git checkout` changes many files at
 * once. Re-running the classification is one query and one hash per document, and it is
 * correct for all of them.
 */
export interface CorpusWatcherOptions {
  rootDir: string;
  extensions?: string[];
  /** Called for every relevant filesystem event. Debouncing is the scheduler's job. */
  onChange: (path: string) => void;
  /** Called once the initial scan is complete, so the CLI can say it is ready. */
  onReady?: () => void;
}

const DEFAULT_EXTENSIONS = [".md", ".markdown"];

export function watchCorpus(options: CorpusWatcherOptions): FSWatcher {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;

  const watcher = chokidar.watch(options.rootDir, {
    // Otherwise chokidar emits an `add` for every existing file on startup, which would
    // trigger a run before anything has actually changed. The CLI does one pass up front
    // by itself, deliberately, so the initial state is handled explicitly.
    ignoreInitial: true,

    // Waits for a file to stop growing before reporting it. A large file copied into the
    // directory otherwise fires while it is still half-written, and the run reads a
    // truncated document and stores a hash for content that no longer exists.
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },

    ignored: (path, stats) => {
      if (stats?.isFile() !== true) return false;
      const lower = path.toLowerCase();
      return !extensions.some((extension) => lower.endsWith(extension));
    },
  });

  for (const event of ["add", "change", "unlink"] as const) {
    watcher.on(event, (path: string) => {
      options.onChange(path);
    });
  }

  watcher.on("ready", () => options.onReady?.());

  // Reported rather than thrown: a watcher that dies on one permission error stops
  // watching everything else too.
  watcher.on("error", (error: unknown) => {
    console.error(`watch error: ${error instanceof Error ? error.message : String(error)}`);
  });

  return watcher;
}
