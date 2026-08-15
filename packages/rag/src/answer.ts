import { type AnswerResponse } from "@corpus-lens/shared/answer";

import { NO_ANSWER_SENTINEL, SYSTEM_PROMPT, buildUserPrompt } from "./answer-prompt";
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

/** Bound on generated length. Answers are a few sentences; this is a cost guard. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 700;

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
      droppedMarkers: [],
      timings: { ...timings, generateMs: null, totalMs: Date.now() - startedAt },
    };
  }

  const generateStartedAt = Date.now();
  const raw = await input.chatProvider.complete({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input.question, passages) },
    ],
    maxOutputTokens: input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: input.temperature ?? DEFAULT_TEMPERATURE,
    onToken: input.onToken,
  });
  const generateMs = Date.now() - generateStartedAt;

  const finish = (
    result: Omit<AnswerResult, "question" | "sources" | "timings">,
  ): AnswerResult => ({
    question: input.question,
    sources: passages,
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

  const validated = validateCitations(raw.trim(), passages);

  return finish({
    answered: true,
    text: validated.text,
    citations: validated.citations,
    abstainReason: null,
    droppedMarkers: validated.droppedMarkers,
  });
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
