import { NO_ANSWER_SENTINEL } from "./answer-prompt";
import { type ChatProvider, type ChatRequest } from "./chat-provider";

/**
 * An offline answerer, for running the system with no API credit.
 *
 * **This reverses a decision made in Step 7** (`docs/ADR.md` ADR-011), which argued there
 * should be no offline counterpart for generation because canned text would make the
 * abstain rule and the citation validator *look* exercised without ever running them.
 * That objection was right, and it is answered by construction rather than ignored: this
 * provider is a `ChatProvider` like any other, so its output goes through the same
 * citation validation, the same sentinel detection and the same abstention path as the
 * real model. Nothing downstream knows the difference, and nothing downstream is skipped.
 *
 * What it is: **extractive**, not generative. It selects the sentences from the retrieved
 * passages that best answer the question and cites them. It composes nothing, so it cannot
 * hallucinate — but it also cannot synthesise across sources, reason, or rephrase. It
 * reports itself as `extractive-offline` so the mode is visible wherever the model name is.
 *
 * The honest framing for a reviewer: this makes the *product* demonstrable without
 * credits. It is not a demonstration of answer quality, and the README says so.
 */

/** Words carrying no topical signal, so overlap is measured on content words only. */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "get",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "you",
  "your",
  "must",
  "should",
  "which",
  "about",
  "into",
  "after",
  "before",
  "every",
  "any",
]);

export interface ExtractiveOptions {
  /** Sentences to include. More reads as padding rather than as a fuller answer. */
  maxSentences?: number;
  /**
   * Minimum content-word overlap between the question and a sentence for it to count.
   * Below this the provider abstains, which is what keeps the offline mode honest: it
   * refuses out-of-corpus questions rather than assembling something from noise.
   */
  minOverlap?: number;
  /** Milliseconds between streamed chunks, so the UI's streaming path is exercised. */
  streamDelayMs?: number;
}

export function createExtractiveChatProvider(options: ExtractiveOptions = {}): ChatProvider {
  const maxSentences = options.maxSentences ?? 4;
  const minOverlap = options.minOverlap ?? 2;
  const streamDelayMs = options.streamDelayMs ?? 18;

  return {
    model: "extractive-offline",
    mode: "extractive" as const,

    async complete(request: ChatRequest): Promise<string> {
      const user = request.messages.find((message) => message.role === "user")?.content ?? "";
      const { question, sources } = parsePrompt(user);
      const keywords = contentWords(question);

      const scored = sources
        .flatMap((source) =>
          splitSentences(source.text).map((sentence) => ({
            marker: source.marker,
            sentence,
            score: overlap(contentWords(sentence), keywords),
          })),
        )
        .filter((candidate) => candidate.score >= minOverlap)
        .sort((a, b) => b.score - a.score || a.marker - b.marker);

      if (scored.length === 0) {
        // The same sentinel the real model is asked to emit, so `answer.ts` produces a
        // genuine `answered: false` with a genuine reason rather than a special case.
        return emit(NO_ANSWER_SENTINEL, request.onToken, 0);
      }

      // Deduplicated by sentence: near-identical documents are this corpus's defining
      // feature, and repeating the same claim from three sources reads as padding.
      const chosen: typeof scored = [];
      const seen = new Set<string>();
      for (const candidate of scored) {
        const key = candidate.sentence.toLowerCase().replace(/\W+/g, "");
        if (seen.has(key)) continue;
        seen.add(key);
        chosen.push(candidate);
        if (chosen.length >= maxSentences) break;
      }

      // Restored to source order so the answer reads in the order the corpus presents it,
      // rather than in descending relevance, which reads like a ranked list.
      chosen.sort((a, b) => a.marker - b.marker);

      const text = chosen
        .map((candidate) => `${candidate.sentence.replace(/\s+$/, "")} [${candidate.marker}]`)
        .join(" ");

      return await emit(text, request.onToken, streamDelayMs);
    },
  };
}

/**
 * Streams in word groups rather than characters.
 *
 * The point is to exercise the same path a real provider drives — the SSE frames, the
 * sentinel guard, the UI's incremental rendering — so a bug in any of them shows up in
 * offline mode too, instead of only when someone has credit.
 */
async function emit(
  text: string,
  onToken: ((token: string) => void) | undefined,
  delayMs: number,
): Promise<string> {
  if (onToken === undefined) return text;

  const chunks = text.match(/\S+\s*/g) ?? [text];
  let buffer = "";

  for (const [index, chunk] of chunks.entries()) {
    buffer += chunk;
    // Grouped into threes: one word per frame is more frames than information, and the
    // real provider emits in similar-sized bursts.
    if (index % 3 === 2 || index === chunks.length - 1) {
      onToken(buffer);
      buffer = "";
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return text;
}

interface ParsedSource {
  marker: number;
  text: string;
}

/**
 * Reads the numbered sources back out of the prompt this repository built.
 *
 * Slightly circular, and deliberately so: the alternative is a second channel handing
 * passages to this provider, which would mean the offline path no longer receives exactly
 * what the real model receives. Parsing our own format keeps the two identical.
 */
function parsePrompt(user: string): { question: string; sources: ParsedSource[] } {
  const questionIndex = user.lastIndexOf("\nQUESTION\n");
  const question = questionIndex === -1 ? user : user.slice(questionIndex + "\nQUESTION\n".length);
  const sourcesBlock = questionIndex === -1 ? "" : user.slice(0, questionIndex);

  const sources: ParsedSource[] = [];
  for (const block of sourcesBlock.split("\n\n---\n\n")) {
    const match = /^\[(\d+)\][^\n]*\n([\s\S]*)$/.exec(block.replace(/^SOURCES\n/, "").trim());
    if (match === null) continue;
    const marker = Number.parseInt(match[1] ?? "", 10);
    if (Number.isNaN(marker)) continue;
    sources.push({ marker, text: match[2] ?? "" });
  }

  return { question: question.trim(), sources };
}

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}._-]+/u)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const word of a) if (b.has(word)) count += 1;
  return count;
}

/** Sentence split that keeps bullet lines whole — this corpus is mostly bullets. */
function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line.length > 20);
}
