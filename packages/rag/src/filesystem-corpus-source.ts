import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { type CorpusSource } from "./ingestion-pipeline";

/**
 * A directory of Markdown files, read as a corpus.
 *
 * The directory is a parameter, never a constant: CLAUDE.md §5 requires that pointing
 * ingestion at another folder is a configuration change. Nothing in this file knows what
 * the sample corpus contains.
 */

export interface FilesystemCorpusSourceOptions {
  /** Absolute path to the corpus root. */
  rootDir: string;
  /** File extensions to ingest, lower-case and dot-prefixed. */
  extensions?: string[];
}

const DEFAULT_EXTENSIONS = [".md", ".markdown"];

/** Directories never worth walking. Skipped before they are read, not after. */
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", ".obsidian", ".DS_Store"]);

export function createFilesystemCorpusSource(options: FilesystemCorpusSourceOptions): CorpusSource {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;

  return {
    description: options.rootDir,

    async list(): Promise<string[]> {
      const files = await walk(options.rootDir, options.rootDir, extensions);
      // Sorted so that two runs over an unchanged corpus process documents in the same
      // order. Directory order is not guaranteed by the OS, and an ingestion log that
      // reshuffles between runs is far harder to diff.
      return files.sort();
    },

    async read(relativePath: string): Promise<{ content: string; contentHash: string }> {
      const bytes = await readFile(join(options.rootDir, relativePath));
      return {
        content: bytes.toString("utf8"),
        // Hashed over the raw bytes rather than the decoded string, so a change in line
        // endings or a BOM counts as a change. This hash is the only thing standing
        // between a re-run and re-embedding the whole corpus, so it should be strict.
        contentHash: createHash("sha256").update(bytes).digest("hex"),
      };
    },
  };
}

async function walk(dir: string, rootDir: string, extensions: string[]): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...(await walk(full, rootDir, extensions)));
      continue;
    }
    if (!entry.isFile()) continue;

    const lower = entry.name.toLowerCase();
    if (!extensions.some((extension) => lower.endsWith(extension))) continue;

    // POSIX separators regardless of platform: the path is a database key and a
    // breadcrumb input, so it must not change shape depending on where ingestion ran.
    results.push(relative(rootDir, full).split(sep).join("/"));
  }

  return results;
}
