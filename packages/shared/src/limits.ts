/**
 * Every bound the API enforces, in one place.
 *
 * These are security constants, not styling: CLAUDE.md §9 requires every input to be
 * bounded, and an unbounded topK is a denial-of-service vector against the embedding and
 * LLM bill. Keeping them here means the browser can disable a submit button using the
 * same number the server rejects on, instead of the two drifting apart.
 */

export const QUERY_MIN_LENGTH = 1;

/**
 * Long enough for a real question, short enough that the embedding call cannot be abused.
 * The sample questions are all well under 120 characters.
 */
export const QUERY_MAX_LENGTH = 500;

export const TOP_K_MIN = 1;

/**
 * The retriever fetches ~20 candidates per arm before fusion, so asking for more than 20
 * cannot return anything extra — it would only widen the answer context and the bill.
 */
export const TOP_K_MAX = 20;

/** CLAUDE.md §6: six fused chunks go into the answer context. */
export const TOP_K_DEFAULT = 6;

export const PASSWORD_MIN_LENGTH = 12;

/** argon2 hashes the whole input; an unbounded password is a CPU exhaustion vector. */
export const PASSWORD_MAX_LENGTH = 128;

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;
