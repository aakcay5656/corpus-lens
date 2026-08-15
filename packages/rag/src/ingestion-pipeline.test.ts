import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createDeterministicEmbeddingProvider } from "./deterministic-embedding-provider";
import {
  runIngestion,
  type CorpusSource,
  type DocumentWrite,
  type IngestionEvent,
  type IngestionStore,
  type StoredDocumentSummary,
} from "./ingestion-pipeline";
import { type TokenCounter } from "./tokenizer";

/**
 * The whole pipeline runs here with no filesystem, no network and no Postgres — which is
 * the concrete payoff of `packages/rag` receiving interfaces instead of importing
 * `packages/db` (CLAUDE.md §4). The behaviour these tests pin is the behaviour that is
 * hardest to check by hand against a real database: what happens when one document of
 * many fails, and whether a second run really does no work.
 */

const wordCounter: TokenCounter = {
  count: (text) => text.split(/\s+/).filter((word) => word.length > 0).length,
};

const provider = createDeterministicEmbeddingProvider({ dimensions: 32 });

function memorySource(
  files: Record<string, string>,
): CorpusSource & { files: Record<string, string> } {
  const source = {
    files,
    description: "memory://corpus",
    list: () => Promise.resolve(Object.keys(source.files).sort()),
    read: (path: string) => {
      const content = source.files[path];
      if (content === undefined) return Promise.reject(new Error(`unreadable: ${path}`));
      return Promise.resolve({
        content,
        contentHash: createHash("sha256").update(content).digest("hex"),
      });
    },
  };
  return source;
}

interface MemoryStore extends IngestionStore {
  documents: Map<string, DocumentWrite>;
  failed: Map<string, string>;
  events: IngestionEvent[];
  finished: { errorMessage: string | null } | null;
  saveCalls: string[];
}

function memoryStore(): MemoryStore {
  const documents = new Map<string, DocumentWrite>();
  const failed = new Map<string, string>();
  const events: IngestionEvent[] = [];
  const saveCalls: string[] = [];
  let finished: { errorMessage: string | null } | null = null;

  return {
    documents,
    failed,
    events,
    saveCalls,
    get finished() {
      return finished;
    },
    startRun: () => Promise.resolve("run-1"),
    listDocuments: (): Promise<StoredDocumentSummary[]> =>
      Promise.resolve(
        [...documents.values()].map((doc, index) => ({
          id: `doc-${index}`,
          sourcePath: doc.sourcePath,
          contentHash: doc.contentHash,
        })),
      ),
    saveDocument: (write) => {
      saveCalls.push(write.sourcePath);
      const created = !documents.has(write.sourcePath);
      documents.set(write.sourcePath, write);
      failed.delete(write.sourcePath);
      return Promise.resolve({ created });
    },
    markDocumentFailed: (sourcePath, message) => {
      failed.set(sourcePath, message);
      return Promise.resolve();
    },
    removeDocuments: (sourcePaths) => {
      for (const path of sourcePaths) documents.delete(path);
      return Promise.resolve();
    },
    recordEvent: (_runId, event) => {
      events.push(event);
      return Promise.resolve();
    },
    finishRun: (_runId, summary) => {
      finished = { errorMessage: summary.errorMessage };
      return Promise.resolve();
    },
  };
}

function run(source: CorpusSource, store: IngestionStore, force = false) {
  return runIngestion({
    source,
    store,
    embeddingProvider: provider,
    tokenCounter: wordCounter,
    trigger: "CLI",
    force,
  });
}

const corpus = {
  "guides/asset-naming.md": "# Asset naming\n\nUse kebab-case for every exported file.",
  "sdk-notes-v3.md": "# Lumen SDK v3 (current)\n\nCall LumenSDK.init before any game code.",
};

describe("runIngestion", () => {
  it("indexes every document and writes one chunk set each", async () => {
    const store = memoryStore();

    const summary = await run(memorySource({ ...corpus }), store);

    expect(summary.documentsAdded).toBe(2);
    expect(summary.documentsFailed).toBe(0);
    expect(summary.chunksWritten).toBe(2);
    expect(store.documents.size).toBe(2);
    expect(store.finished).toEqual({ errorMessage: null });
  });

  it("does no work on a second run over an unchanged corpus", async () => {
    const store = memoryStore();
    const source = memorySource({ ...corpus });

    await run(source, store);
    store.saveCalls.length = 0;
    const second = await run(source, store);

    // The point of the content hash: not "it succeeded twice" but "it did not re-embed".
    expect(second.documentsUnchanged).toBe(2);
    expect(second.documentsAdded).toBe(0);
    expect(second.chunksWritten).toBe(0);
    expect(store.saveCalls).toEqual([]);
  });

  it("re-embeds an unchanged corpus when forced", async () => {
    const store = memoryStore();
    const source = memorySource({ ...corpus });

    await run(source, store);
    const second = await run(source, store, true);

    expect(second.documentsUnchanged).toBe(0);
    expect(second.documentsUpdated).toBe(2);
  });

  it("re-indexes only the document whose content changed", async () => {
    const store = memoryStore();
    const source = memorySource({ ...corpus });

    await run(source, store);
    source.files["sdk-notes-v3.md"] = "# Lumen SDK v3 (current)\n\nInitialization changed.";
    store.saveCalls.length = 0;
    const second = await run(source, store);

    expect(second.documentsUpdated).toBe(1);
    expect(second.documentsUnchanged).toBe(1);
    expect(store.saveCalls).toEqual(["sdk-notes-v3.md"]);
  });

  it("records a failing document and keeps going", async () => {
    const store = memoryStore();
    const base = memorySource({ ...corpus });
    // A file that lists but cannot be read — a permissions problem, a deleted file, a bad
    // symlink. Exactly the case that must not abort a 142-document run.
    const source: CorpusSource = {
      description: base.description,
      list: () => Promise.resolve([...Object.keys(corpus), "broken.md"].sort()),
      read: (path) =>
        path === "broken.md" ? Promise.reject(new Error("permission denied")) : base.read(path),
    };

    const summary = await run(source, store);

    expect(summary.documentsFailed).toBe(1);
    expect(summary.documentsAdded).toBe(2);
    expect(summary.failures[0]?.sourcePath).toBe("broken.md");
    expect(store.failed.has("broken.md")).toBe(true);
    // The run itself completed: individual failures are counted, not fatal.
    expect(store.finished).toEqual({ errorMessage: null });
  });

  it("records the phase a failure came from", async () => {
    const store = memoryStore();
    const source = memorySource({ ...corpus });
    const failing: CorpusSource = {
      ...source,
      read: () => Promise.reject(new Error("permission denied")),
    };

    await run(failing, store);

    const errors = store.events.filter((event) => event.level === "ERROR");
    expect(errors).toHaveLength(2);
    expect(errors[0]?.phase).toBe("PARSE");
    expect(errors[0]?.message).toBe("permission denied");
  });

  it("deletes documents that have left the corpus", async () => {
    const store = memoryStore();
    const source = memorySource({ ...corpus });

    await run(source, store);
    delete source.files["sdk-notes-v3.md"];
    const second = await run(source, store);

    expect(second.documentsRemoved).toBe(1);
    expect(store.documents.has("sdk-notes-v3.md")).toBe(false);
  });

  it("carries path metadata and body attributes onto the document write", async () => {
    const store = memoryStore();

    await run(
      memorySource({
        "delivery-reports/2025-12-merge-marina.md": "# Delivery Report\n\nClient: BlueHarbor.",
        "sdk-notes-v2.md": "# Lumen SDK v2 (DEPRECATED)\n\nStatus: deprecated since January 2026.",
      }),
      store,
    );

    const report = store.documents.get("delivery-reports/2025-12-merge-marina.md");
    expect(report?.docType).toBe("delivery-report");
    expect(report?.docDate).toBe("2025-12");
    expect(report?.subject).toBe("merge-marina");

    // The supersession is stored as data, so Step 7's conflict rule does not depend on the
    // model noticing the word "DEPRECATED" in the prose.
    expect(store.documents.get("sdk-notes-v2.md")?.lifecycle).toBe("deprecated");
    expect(store.documents.get("sdk-notes-v2.md")?.version).toBe("2");
  });

  it("strips front-matter from the chunked body and stores it as metadata", async () => {
    const store = memoryStore();

    await run(
      memorySource({
        "note.md": "---\nauthor: Marco\nstatus: draft\n---\n# Note\n\nThe body text.",
      }),
      store,
    );

    const note = store.documents.get("note.md");
    expect(note?.metadata).toEqual({ author: "Marco", status: "draft" });
    expect(note?.chunks[0]?.chunk.content).toBe("The body text.");
    expect(note?.chunks[0]?.chunk.content).not.toContain("author");
  });

  it("skips an empty document with a warning instead of indexing nothing", async () => {
    const store = memoryStore();

    const summary = await run(memorySource({ "empty.md": "   \n\n" }), store);

    expect(summary.documentsAdded).toBe(0);
    expect(store.documents.size).toBe(0);
    expect(store.events.some((event) => event.level === "WARN")).toBe(true);
  });

  it("marks the run failed when the corpus itself cannot be listed", async () => {
    const store = memoryStore();
    const source: CorpusSource = {
      description: "memory://broken",
      list: () => Promise.reject(new Error("corpus directory disappeared")),
      read: () => Promise.reject(new Error("unreachable")),
    };

    await expect(run(source, store)).rejects.toThrow("corpus directory disappeared");
    expect(store.finished?.errorMessage).toBe("corpus directory disappeared");
  });

  it("gives every chunk an embedding of the provider's width", async () => {
    const store = memoryStore();

    await run(memorySource({ ...corpus }), store);

    for (const document of store.documents.values()) {
      for (const { embedding } of document.chunks) {
        expect(embedding).toHaveLength(32);
      }
    }
  });
});
