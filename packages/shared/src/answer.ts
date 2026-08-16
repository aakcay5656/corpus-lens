import { z } from "zod";
import { QUERY_MAX_LENGTH, QUERY_MIN_LENGTH, TOP_K_DEFAULT, TOP_K_MAX, TOP_K_MIN } from "./limits";
import { passageSchema } from "./search";

export const answerRequestSchema = z.object({
  question: z.string().trim().min(QUERY_MIN_LENGTH).max(QUERY_MAX_LENGTH),
  topK: z.number().int().min(TOP_K_MIN).max(TOP_K_MAX).default(TOP_K_DEFAULT),
  docType: z.string().trim().min(1).max(64).optional(),
});

/**
 * A resolved `[n]` marker from the answer text.
 *
 * `marker` is the number the model wrote and `sourceIndex` is its position in the sources
 * array. They are kept separate rather than assumed equal because the server validates
 * markers against the supplied context and drops unknown ones (CLAUDE.md §6) — after a
 * drop, the surviving markers are no longer contiguous, and the UI needs to resolve what
 * the model actually wrote, not what it should have written.
 */
export const citationSchema = z.object({
  marker: z.number().int().min(1),
  sourceIndex: z.number().int().min(0),
  chunkId: z.uuid(),
  documentId: z.uuid(),
  documentTitle: z.string(),
  sourcePath: z.string(),
  breadcrumb: z.string(),
});

/**
 * Why the system declined to answer. A closed set rather than prose, so the UI can render
 * abstention as a first-class state and the dashboard can count the causes.
 *
 * The two values correspond to the two independent layers of abstention: the retrieval
 * score floor short-circuits before the model is called, and the prompt instructs the
 * model to refuse when the context does not contain the answer.
 */
export const abstainReasonSchema = z.enum([
  /** Nothing retrieved, or the best fused score was below the floor. Model never called. */
  "NO_RELEVANT_CONTEXT",
  /** Chunks were retrieved but the model judged them insufficient and said so. */
  "MODEL_DECLINED",
]);

export const answerTimingsSchema = z.object({
  embedMs: z.number().int(),
  retrieveMs: z.number().int(),
  /** Null when the score floor short-circuited before the model was called. */
  generateMs: z.number().int().nullable(),
  totalMs: z.number().int(),
});

export const answerResponseSchema = z.object({
  question: z.string(),

  /**
   * False means "the corpus does not cover this". A boolean rather than a hedge in the
   * prose, so the UI renders a distinct state instead of a paragraph of apology, and the
   * abstain rate is a metric rather than a string search (CLAUDE.md §6).
   */
  answered: z.boolean(),

  /** The grounded answer, or the abstention message when `answered` is false. */
  text: z.string(),

  /** Always empty when `answered` is false — an abstention may never carry a citation. */
  citations: z.array(citationSchema),

  /** The chunks put in front of the model, in the order the markers refer to. */
  sources: z.array(passageSchema),

  abstainReason: abstainReasonSchema.nullable(),

  /**
   * Which answerer produced this.
   *
   * On the wire rather than inferred from configuration, because it changes how much the
   * answer can be trusted and the client must not have to guess. `extractive` selects
   * sentences from the retrieved passages with no language model involved: it cannot
   * hallucinate, but it also cannot judge whether the passages actually answer the
   * question — measured across the 16 labelled evaluation queries, no lexical threshold
   * separates "the corpus contains the answer" from "the corpus contains the words". So in
   * that mode the second abstention layer is absent and the UI has to say so.
   */
  answerMode: z.enum(["model", "extractive"]),

  timings: answerTimingsSchema,
});

export type AnswerRequest = z.infer<typeof answerRequestSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type AbstainReason = z.infer<typeof abstainReasonSchema>;
export type AnswerTimings = z.infer<typeof answerTimingsSchema>;
export type AnswerResponse = z.infer<typeof answerResponseSchema>;
