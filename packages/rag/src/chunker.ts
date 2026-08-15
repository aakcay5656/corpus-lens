import { buildBreadcrumb, buildEmbeddedText } from "./breadcrumb";
import { parseMarkdown, type MarkdownSection } from "./markdown-sections";
import { deriveSourceMetadata, type SourceMetadata } from "./source-metadata";
import { type TokenCounter } from "./tokenizer";

/**
 * Markdown-aware chunking: structure first, size second.
 *
 * Parameters come from docs/CORPUS.md §5, which measured the corpus before any of this
 * was written. The important thing to understand about them is that on *this* corpus the
 * splitting machinery never fires — the largest document is 217 tokens against a 500
 * token budget — and the **merge** pass is what does the work, collapsing each document
 * into a single chunk. The split path is written and tested anyway, because CLAUDE.md §5
 * requires ingestion to work against any directory, and a corpus of long documents needs
 * it. Tuning the budget down to fit a 23k-token sample would be overfitting.
 */
export interface ChunkOptions {
  /** Maximum tokens per chunk, counted on the text actually sent to the model. */
  budgetTokens: number;
  /** Context repeated across a size-forced split, so a cut sentence stays interpretable. */
  overlapTokens: number;
  /** Below this a chunk is absorbed into a neighbour instead of embedded alone. */
  minChunkTokens: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  budgetTokens: 500,
  overlapTokens: 60,
  minChunkTokens: 80,
};

export interface DocumentChunk {
  /** Position within the document. Unique per document — packages/db enforces it. */
  ordinal: number;
  breadcrumb: string;
  /** Chunk body without the breadcrumb. Displayed to the user as the cited passage. */
  content: string;
  /** breadcrumb + content: what gets embedded, and what the tsvector is built from. */
  embeddedText: string;
  /** Token count of `embeddedText`, i.e. of what the model actually receives. */
  tokenCount: number;
}

export interface ChunkDocumentInput {
  /** Path relative to the corpus root, used for the metadata in the breadcrumb. */
  relativePath: string;
  source: string;
  tokenCounter: TokenCounter;
  options?: Partial<ChunkOptions>;
}

export interface ChunkedDocument {
  title: string;
  metadata: SourceMetadata;
  chunks: DocumentChunk[];
}

/**
 * One piece of a document on its way to becoming a chunk. Pieces are produced by the
 * heading split, cut down by the size split, then merged back together — carrying the
 * heading path throughout so the breadcrumb can be built at the end.
 */
interface Piece {
  headingPath: string[];
  content: string;
  tokens: number;
}

export function chunkDocument(input: ChunkDocumentInput): ChunkedDocument {
  const options = { ...DEFAULT_CHUNK_OPTIONS, ...input.options };
  const { tokenCounter } = input;

  const metadata = deriveSourceMetadata(input.relativePath);
  const parsed = parseMarkdown(input.source);
  // A document with no `#` still needs a name in its citation; the filename is the
  // honest fallback and is what a reader would call the file anyway.
  const title = parsed.title ?? metadata.subject;

  // Every chunk pays for its breadcrumb, so the budget available to content is what is
  // left after it. Measured on the document-level head because the merge pass decides
  // heading paths after sizing, and the head is the part every breadcrumb shares.
  const headTokens = tokenCounter.count(buildBreadcrumb(title, metadata, []));
  const contentBudget = Math.max(
    options.budgetTokens - headTokens,
    minimumContentBudget(options.budgetTokens),
  );

  const sized = parsed.sections.flatMap((section) =>
    splitSection(section, contentBudget, options.overlapTokens, tokenCounter),
  );
  const merged = mergePieces(sized, contentBudget, tokenCounter);
  const absorbed = absorbSmallPieces(merged, options.minChunkTokens, tokenCounter);

  const chunks = absorbed.map((piece, index) => {
    const breadcrumb = buildBreadcrumb(title, metadata, piece.headingPath);
    const embeddedText = buildEmbeddedText(breadcrumb, piece.content);
    return {
      ordinal: index,
      breadcrumb,
      content: piece.content,
      embeddedText,
      tokenCount: tokenCounter.count(embeddedText),
    };
  });

  return { title, metadata, chunks };
}

/**
 * Floor for the content budget, as a fraction of the configured budget.
 *
 * The guard exists because a pathological breadcrumb — a very long title, or a corpus
 * with deeply nested headings — could otherwise leave zero or negative room for content
 * and the splitter would produce empty pieces forever.
 *
 * It is a *fraction*, not a constant, and that distinction is the whole point: a
 * constant floor silently ignores any budget smaller than itself, which means a caller
 * who configures a small budget gets a large one and never finds out. Expressed this
 * way the rule is "a breadcrumb may not eat more than three quarters of the budget",
 * which holds at every scale.
 */
const MINIMUM_CONTENT_BUDGET_RATIO = 0.25;

function minimumContentBudget(budgetTokens: number): number {
  return Math.max(1, Math.ceil(budgetTokens * MINIMUM_CONTENT_BUDGET_RATIO));
}

// ---------------------------------------------------------------------------
// Pass 1 — size split. Only fires when a single section exceeds the budget.
// ---------------------------------------------------------------------------

function splitSection(
  section: MarkdownSection,
  budget: number,
  overlapTokens: number,
  counter: TokenCounter,
): Piece[] {
  const tokens = counter.count(section.content);
  if (tokens <= budget) {
    return [{ headingPath: section.headingPath, content: section.content, tokens }];
  }

  // Paragraphs are the coarsest boundary below a heading, so they are tried first; a
  // paragraph that is itself over budget falls back to sentences. Below sentences we do
  // not go — CLAUDE.md §6 forbids splitting mid-sentence, and a single over-budget
  // sentence is better embedded whole and slightly oversized than cut in half.
  const units = splitIntoParagraphs(section.content).flatMap((paragraph) =>
    counter.count(paragraph) <= budget ? [paragraph] : splitIntoSentences(paragraph),
  );

  const groups = groupUnits(units, budget, counter);
  return groups.map((group, index) => {
    const previous = index > 0 ? groups[index - 1] : undefined;
    const overlap = previous === undefined ? "" : takeTail(previous, overlapTokens, counter);
    const content = overlap.length > 0 ? `${overlap}\n\n${group}` : group;
    return { headingPath: section.headingPath, content, tokens: counter.count(content) };
  });
}

/** Greedily fills groups up to the budget, never breaking a unit across two groups. */
function groupUnits(units: string[], budget: number, counter: TokenCounter): string[] {
  const groups: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const unit of units) {
    const unitTokens = counter.count(unit);
    if (current.length > 0 && currentTokens + unitTokens > budget) {
      groups.push(current.join("\n\n"));
      current = [];
      currentTokens = 0;
    }
    current.push(unit);
    currentTokens += unitTokens;
  }
  if (current.length > 0) groups.push(current.join("\n\n"));
  return groups;
}

/** Trailing whole sentences of `text`, up to `budget` tokens. Never a partial sentence. */
function takeTail(text: string, budget: number, counter: TokenCounter): string {
  if (budget <= 0) return "";
  const sentences = splitIntoSentences(text);
  const tail: string[] = [];
  let tokens = 0;

  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const sentence = sentences[index] ?? "";
    const sentenceTokens = counter.count(sentence);
    if (tokens + sentenceTokens > budget) break;
    tail.unshift(sentence);
    tokens += sentenceTokens;
  }
  return tail.join(" ");
}

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

/** Splits after `.`, `!` or `?` followed by whitespace. Lookbehind keeps the mark. */
function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

// ---------------------------------------------------------------------------
// Pass 2 — merge. This is the pass that actually runs on the sample corpus.
// ---------------------------------------------------------------------------

/**
 * Greedily merges adjacent pieces while the running total fits the budget.
 *
 * When pieces from different sections merge, their shared heading prefix becomes the
 * chunk's breadcrumb and the headings *below* that prefix are written back into the
 * content. Nothing is lost either way: a heading is either in the breadcrumb or in the
 * text, never dropped. A single unmerged piece keeps its full path in the breadcrumb,
 * which is the ordinary CLAUDE.md §6 case.
 *
 * No overlap is added here. Overlap exists to soften an arbitrary cut; a heading
 * boundary is not arbitrary, so repeating text across one would be pure duplication.
 */
function mergePieces(pieces: Piece[], budget: number, counter: TokenCounter): Piece[] {
  const merged: Piece[] = [];
  let group: Piece[] = [];
  let groupTokens = 0;

  const flush = (): void => {
    if (group.length === 0) return;
    merged.push(renderGroup(group, counter));
    group = [];
    groupTokens = 0;
  };

  for (const piece of pieces) {
    if (group.length > 0 && groupTokens + piece.tokens > budget) flush();
    group.push(piece);
    groupTokens += piece.tokens;
  }
  flush();

  return merged;
}

/**
 * Collapses a run of pieces into one, promoting their shared heading path to the
 * breadcrumb and writing the headings below it back into the body as Markdown.
 *
 * Recounts tokens rather than summing the pieces', because the reinstated heading lines
 * are new text and a chunk's recorded size has to match what the model receives.
 */
function renderGroup(group: Piece[], counter: TokenCounter): Piece {
  const first = group[0];
  if (first === undefined) throw new Error("renderGroup called with an empty group");
  if (group.length === 1) return first;

  const shared = commonPrefix(group.map((piece) => piece.headingPath));
  const body = group
    .map((piece) => {
      const ownHeadings = piece.headingPath.slice(shared.length);
      const lines = ownHeadings.map(
        // +2 because level 1 is the document title, which never enters the path.
        (heading, index) => `${"#".repeat(shared.length + index + 2)} ${heading}`,
      );
      return [...lines, piece.content].join("\n\n");
    })
    .join("\n\n");

  return { headingPath: shared, content: body, tokens: counter.count(body) };
}

function commonPrefix(paths: string[][]): string[] {
  const first = paths[0];
  if (first === undefined) return [];

  const prefix: string[] = [];
  for (let index = 0; index < first.length; index += 1) {
    const candidate = first[index];
    if (candidate === undefined) break;
    if (!paths.every((path) => path[index] === candidate)) break;
    prefix.push(candidate);
  }
  return prefix;
}

// ---------------------------------------------------------------------------
// Pass 3 — absorb fragments.
// ---------------------------------------------------------------------------

/**
 * Folds any chunk below the minimum into its neighbour.
 *
 * A 21-token changelog embedded on its own is a low-signal vector that competes with
 * real content for a place in the top 6 (docs/CORPUS.md §5). Absorbing it can push the
 * neighbour slightly over budget, which is the right trade: the budget is a safety valve
 * against the model's input limit, and a sub-80-token overflow is nowhere near it.
 *
 * A document whose *entire* content is below the minimum is left as one small chunk —
 * there is no neighbour to absorb it into, and dropping it would lose the document.
 */
function absorbSmallPieces(
  pieces: Piece[],
  minChunkTokens: number,
  counter: TokenCounter,
): Piece[] {
  if (pieces.length <= 1) return pieces;

  // Build runs rather than concatenating strings directly, so the merge goes through
  // renderGroup and an absorbed piece's heading is preserved in the body instead of
  // vanishing along with its breadcrumb path.
  const runs: Piece[][] = [];
  for (const piece of pieces) {
    const openRun = runs.at(-1);
    if (openRun !== undefined && piece.tokens < minChunkTokens) {
      openRun.push(piece);
      continue;
    }
    runs.push([piece]);
  }

  const absorbed = runs.map((run) => renderGroup(run, counter));

  // The very first chunk has no predecessor, so if it is still short it merges forwards.
  const first = absorbed[0];
  if (absorbed.length > 1 && first !== undefined && first.tokens < minChunkTokens) {
    const second = absorbed[1];
    if (second !== undefined) {
      absorbed.splice(0, 2, renderGroup([first, second], counter));
    }
  }

  return absorbed;
}
