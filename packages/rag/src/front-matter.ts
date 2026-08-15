/**
 * YAML front-matter, parsed deliberately narrowly.
 *
 * The provided corpus has **none** — docs/CORPUS.md §2 checked all 142 files. This exists
 * for the requirement that ingestion works against any directory (CLAUDE.md §5), which
 * makes it the wrong place to spend a dependency: pulling in a full YAML parser to handle
 * a construct this corpus does not contain would be a library added on speculation.
 *
 * So the support is flat `key: value` pairs and nothing else. Nested maps, lists, block
 * scalars and anchors are not parsed — a line that is not a `key: value` pair is skipped
 * and the fact is reported, so an unsupported document produces a visible warning rather
 * than silently losing its metadata. If a future corpus needs real YAML, this is one
 * module to swap and the warning is what will tell you it is time.
 */

export interface ParsedFrontMatter {
  /** Flat key/value pairs. Empty when the document has no front-matter. */
  data: Record<string, string>;
  /** The document with its front-matter block removed. This is what gets chunked. */
  body: string;
  /** Lines inside the block this parser could not read. Logged as an ingestion warning. */
  unsupportedLines: string[];
}

/** A front-matter fence: exactly three dashes on a line of their own. */
const FENCE = /^---[ \t]*$/;

export function parseFrontMatter(source: string): ParsedFrontMatter {
  const lines = source.split(/\r?\n/);

  const firstLine = lines[0];
  if (firstLine === undefined || !FENCE.test(firstLine)) {
    return { data: {}, body: source, unsupportedLines: [] };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && FENCE.test(line));
  if (closingIndex === -1) {
    // An opening fence with no closing one is not front-matter; it is a horizontal rule
    // or a broken file. Treating it as metadata would swallow the whole document.
    return { data: {}, body: source, unsupportedLines: [] };
  }

  const data: Record<string, string> = {};
  const unsupportedLines: string[] = [];

  for (const line of lines.slice(1, closingIndex)) {
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) continue;

    const separator = line.indexOf(":");
    const key = separator === -1 ? "" : line.slice(0, separator).trim();
    // A key with leading whitespace is a nested entry, which this parser does not model.
    if (separator === -1 || key.length === 0 || line.startsWith(" ") || line.startsWith("\t")) {
      unsupportedLines.push(line);
      continue;
    }

    data[key] = stripQuotes(line.slice(separator + 1).trim());
  }

  return { data, body: lines.slice(closingIndex + 1).join("\n"), unsupportedLines };
}

function stripQuotes(value: string): string {
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  return quoted && value.length >= 2 ? value.slice(1, -1) : value;
}
