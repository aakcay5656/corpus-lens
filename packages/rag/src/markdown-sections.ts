/**
 * Splitting Markdown into heading-delimited sections.
 *
 * This is a line scanner, not a CommonMark AST. That is a deliberate choice, and the
 * corpus is the reason: every changelog in it indents its first bullet by four spaces,
 * which CommonMark parses as an indented *code block*. An AST-based chunker sees that
 * line as code, and either drops it or refuses to split near it. A scanner that only
 * cares about two things — where headings are, and where fenced code starts and ends —
 * treats it as what it plainly is, a line of text inside a section.
 *
 * The only structure we need is the heading hierarchy, so the only structure we parse
 * is the heading hierarchy. See docs/CORPUS.md §5 "Parsing hazard found".
 */

/** An ATX heading line: one to six '#', a space, then the text. */
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** An opening or closing code fence: three or more backticks or tildes, any indent. */
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;

export interface MarkdownSection {
  /**
   * Ancestor headings above this section, outermost first, excluding the document
   * title. A section directly under `## QA findings` has `["QA findings"]`.
   * Content before the first heading below the title has an empty path.
   */
  headingPath: string[];
  /** Section body with the heading line itself removed, trimmed of blank edges. */
  content: string;
}

export interface ParsedMarkdown {
  /** Text of the first level-1 heading, if the document has one. */
  title: string | null;
  sections: MarkdownSection[];
}

/**
 * Reads a Markdown document into a title plus a flat list of sections.
 *
 * Flat, not nested, because the chunker merges and splits over a linear sequence — a
 * tree would have to be flattened again immediately. Each section carries the full
 * ancestor path instead, which is exactly what the breadcrumb needs.
 */
export function parseMarkdown(source: string): ParsedMarkdown {
  const lines = source.split(/\r?\n/);

  let title: string | null = null;
  const sections: MarkdownSection[] = [];

  // Headings currently open, indexed by depth - 1. Setting `length` to close deeper
  // levels can leave holes (an `###` directly under an `#`), hence the undefined slots.
  const openHeadings: (string | undefined)[] = [];
  let currentLines: string[] = [];
  let currentPath: string[] = [];

  // Only closed by a fence of the same character, so a ``` inside a ~~~ block is text.
  let openFence: string | null = null;

  const flush = (): void => {
    const content = trimBlankEdges(currentLines).join("\n");
    if (content.length > 0) {
      sections.push({ headingPath: currentPath, content });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const fence = FENCE_PATTERN.exec(line);
    if (fence !== null) {
      const marker = fence[1] ?? "";
      if (openFence === null) {
        openFence = marker[0] ?? null;
      } else if (marker.startsWith(openFence)) {
        openFence = null;
      }
      currentLines.push(line);
      continue;
    }

    // A '#' inside a fenced block is a comment or a shell prompt, never a heading.
    const heading = openFence === null ? HEADING_PATTERN.exec(line) : null;
    if (heading === null) {
      currentLines.push(line);
      continue;
    }

    const depth = (heading[1] ?? "").length;
    const text = (heading[2] ?? "").trim();

    flush();

    if (depth === 1 && title === null) {
      // The document title heads the breadcrumb rather than appearing inside it, so it
      // opens no path entry. A second `#` in the same file is treated as a section.
      title = text;
      openHeadings.length = 0;
      currentPath = [];
      continue;
    }

    openHeadings.length = depth;
    openHeadings[depth - 1] = text;
    currentPath = openHeadings.filter(
      (entry): entry is string => entry !== undefined && entry.length > 0,
    );
    // The heading text belongs to the breadcrumb, so it is not repeated in the body.
    currentLines = [];
  }

  flush();

  return { title, sections };
}

/** Drops leading and trailing blank lines without touching interior blank lines. */
function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? "").trim().length === 0) start += 1;
  while (end > start && (lines[end - 1] ?? "").trim().length === 0) end -= 1;
  return lines.slice(start, end);
}
