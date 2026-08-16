import { type AnswerResponse } from "@corpus-lens/shared/answer";

import {
  NO_ANSWER_SENTINEL,
  SYSTEM_PROMPT,
  buildUserPrompt,
  dropNearDuplicates,
} from "./answer-prompt";
import { type ChatProvider } from "./chat-provider";
import { validateCitations } from "./citations";
import { DEFAULT_RRF_K } from "./reciprocal-rank-fusion";
import { DEFAULT_CANDIDATE_COUNT, retrieve, type RetrieveInput } from "./retriever";

/**
 * Grounded answering with two independent layers of abstention.
 *
 * Layer 1 is the retrieval score floor below, which decides before the model is called
 * and therefore costs nothing. Layer 2 is rule 4 of the system prompt. They catch
 * different things: the floor catches a question the corpus has no vocabulary for at all,
 * and the prompt catches a question whose *topic* is covered but whose *answer* is not —
 * "how many vacation days" retrieves the company overview with a perfectly good score,
 * because the company overview really is about the company.
 *
 * Neither layer alone is sufficient, which is the argument for having both.
 */

/**
 * The minimum fused score a result must reach before the model is called.
 *
 * Derived from RRF's arithmetic rather than tuned. The value is
 * `1/(k+1) + 1/(k+candidates)`: the score of a chunk ranked **first by one arm and last
 * among candidates by the other**. In other words the floor asserts a single thing — at
 * least one chunk was found by *both* retrieval arms. If neither vector similarity nor
 * keyword matching can agree on anything, the corpus almost certainly does not contain
 * the answer.
 *
 * Measured against the evaluation set: in-corpus questions score 0.0306–0.0328, the
 * fully off-domain question scores 0.0164 — exactly `1/(k+1)`, the signature of one arm
 * contributing alone. The floor lands at 0.0289, cleanly between them, without a number
 * having been chosen to make that happen.
 */
export function minimumFusedScore(
  k: number = DEFAULT_RRF_K,
  candidateCount: number = DEFAULT_CANDIDATE_COUNT,
): number {
  return 1 / (k + 1) + 1 / (k + candidateCount);
}

/**
 * Bound on generated length.
 *
 * Lowered from 700 after measuring: real answers run 150–250 tokens, and providers
 * *reserve* against this number rather than merely capping at it — an exhausted balance
 * refused a request with "you requested up to 700 tokens, but can only afford 178" while
 * having ample credit for the answer actually produced. 400 leaves room for the longest
 * enumeration answers in the evaluation set with no observed truncation.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 400;

/** Extraction and citation, not composition — the same inputs should give same output. */
export const DEFAULT_TEMPERATURE = 0;

export const ABSTENTION_TEXT = "I could not find an answer to this question in the corpus.";

export interface AnswerInput extends Omit<RetrieveInput, "query"> {
  question: string;
  chatProvider: ChatProvider;
  /** Overrides the derived floor. Exposed for tests and for tuning against the eval set. */
  scoreFloor?: number;
  maxOutputTokens?: number;
  temperature?: number;
  /** Forwarded to the provider so the API can stream tokens to the browser. */
  onToken?: (token: string) => void;
}

export interface AnswerResult extends AnswerResponse {
  /**
   * Markers the model wrote that pointed at no supplied source. Not part of the wire
   * contract — the client has no use for them — but the API logs them, because a rising
   * count is the earliest signal that the prompt or the context size has regressed.
   */
  droppedMarkers: number[];
}

export async function answerQuestion(input: AnswerInput): Promise<AnswerResult> {
  const startedAt = Date.now();

  const { passages, timings } = await retrieve({ ...input, query: input.question });

  const floor = input.scoreFloor ?? minimumFusedScore();
  const topScore = passages[0]?.score ?? 0;

  if (passages.length === 0 || topScore < floor) {
    // Layer 1. The model is never called, so an off-domain question costs one embedding
    // rather than a full generation.
    return {
      question: input.question,
      answered: false,
      text: ABSTENTION_TEXT,
      citations: [],
      sources: passages,
      abstainReason: "NO_RELEVANT_CONTEXT",
      answerMode: input.chatProvider.mode,
      droppedMarkers: [],
      timings: { ...timings, generateMs: null, totalMs: Date.now() - startedAt },
    };
  }

  // Deduplicated once, here, and then used for everything: the prompt, the citation
  // validation and the sources reported to the client. Numbering the prompt over one list
  // and validating markers against another would make every citation after a dropped
  // passage point at the wrong document.
  const context = dropNearDuplicates(passages);

  const generateStartedAt = Date.now();
  const raw = await input.chatProvider.complete({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input.question, context) },
    ],
    maxOutputTokens: input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: input.temperature ?? DEFAULT_TEMPERATURE,
    onToken: guardSentinel(input.onToken),
  });
  const generateMs = Date.now() - generateStartedAt;

  const finish = (
    result: Omit<AnswerResult, "question" | "sources" | "timings" | "answerMode">,
  ): AnswerResult => ({
    question: input.question,
    answerMode: input.chatProvider.mode,
    // The deduplicated list, so the UI's source numbering matches the markers the model
    // was given and the citations resolve to what the reader is shown.
    sources: context,
    timings: { ...timings, generateMs, totalMs: Date.now() - startedAt },
    ...result,
  });

  if (isAbstention(raw)) {
    // Layer 2. Note that `citations` is forced empty rather than merely expected to be:
    // an abstention that carries a citation is a contradiction the UI would have to
    // render, and the contract says it never happens.
    return finish({
      answered: false,
      text: ABSTENTION_TEXT,
      citations: [],
      abstainReason: "MODEL_DECLINED",
      droppedMarkers: [],
    });
  }

  const validated = validateCitations(raw.trim(), context);

  return finish({
    answered: true,
    text: validated.text,
    citations: validated.citations,
    abstainReason: null,
    droppedMarkers: validated.droppedMarkers,
  });
}

/**
 * Withholds streamed tokens until the response is known not to be a refusal.
 *
 * When the model declines it emits the raw `NO_ANSWER` sentinel, and a consumer streaming
 * tokens straight through would render it: the user watches "NO_ANSWER" type itself out
 * and then get replaced by the abstention state. It is an internal protocol token and
 * should never reach a screen.
 *
 * The rule is minimal — hold tokens only while what has arrived so far is still a possible
 * *prefix* of the sentinel, then release everything and stream freely. For a real answer
 * that is one token of delay, since the first token almost never begins with "N"; for a
 * refusal nothing is ever emitted. Wrapping it here rather than in the API means every
 * consumer gets it, including any future one that forgets the problem exists.
 */
function guardSentinel(
  onToken: ((token: string) => void) | undefined,
): ((token: string) => void) | undefined {
  if (onToken === undefined) return undefined;

  let held = "";
  let released = false;

  return (token: string): void => {
    if (released) {
      onToken(token);
      return;
    }

    held += token;
    const normalised = held
      .trim()
      .replace(/[*`_\s]/g, "")
      .toUpperCase();
    if (NO_ANSWER_SENTINEL.replace(/_/g, "").startsWith(normalised)) return;

    released = true;
    onToken(held);
  };
}

/**
 * Detects the refusal sentinel.
 *
 * Compared against the whole trimmed response rather than searched for, with one
 * concession: some models wrap a bare sentinel in punctuation or a code fence. What is
 * *not* accepted is the sentinel appearing inside a longer answer — that is a model
 * discussing the instruction, not obeying it, and treating it as a refusal would discard
 * a real answer.
 */
function isAbstention(text: string): boolean {
  const normalised = text
    .trim()
    .replace(/^```[a-z]*\s*|\s*```$/gi, "")
    .replace(/[.*_`\s]/g, "")
    .toUpperCase();

  return normalised === NO_ANSWER_SENTINEL.replace(/_/g, "");
}
