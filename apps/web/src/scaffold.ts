import { type AnswerResponse } from "@corpus-lens/shared/answer";
import { QUERY_MAX_LENGTH } from "@corpus-lens/shared/limits";
import { type SearchRequest } from "@corpus-lens/shared/search";

/**
 * Scaffold placeholder. Next.js, Tailwind and the App Router tree arrive in Step 10.
 *
 * The imports are the point: the browser derives its types from the same Zod schemas the
 * API validates against, so a change to the contract breaks this build rather than
 * production. Nothing here is hand-written twice (CLAUDE.md §7).
 */

/** The input length the textarea will cap at — the same constant the server rejects on. */
export const questionMaxLength = QUERY_MAX_LENGTH;

/** Placeholder for the fetch wrapper Step 10 replaces this with. */
export function buildSearchRequest(query: string): SearchRequest {
  return { query, topK: 6 };
}

/**
 * Abstention is a state to render, not a string to detect. Written now because it is the
 * one branch the chat page must not get wrong.
 */
export function isAbstention(answer: AnswerResponse): boolean {
  return !answer.answered;
}
