/**
 * The seam between answering and whatever generates text.
 *
 * CLAUDE.md §3 asks for this interface so the generation model is swappable. It is the
 * same shape as `EmbeddingProvider`: the answering code never learns which model it is
 * talking to, which is what lets `answer.ts` be unit-tested against a stub that returns a
 * fixed string — including the stub that returns a citation to a source that was never
 * supplied, which is the case the validator exists for.
 */

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Hard cap on generated tokens. An unbounded completion is a cost incident. */
  maxOutputTokens: number;
  /**
   * Near-zero by default. This task is extraction and citation, not composition — the
   * same question against the same context should give the same answer, and creativity
   * here shows up as invented detail rather than better prose.
   */
  temperature: number;
  /** Called per streamed chunk. Absent means the caller does not need tokens as they land. */
  onToken?: (token: string) => void;
}

export interface ChatProvider {
  readonly model: string;
  /**
   * Returns the complete text. Streams internally when `onToken` is supplied, so the
   * caller gets tokens as they arrive *and* the assembled string — the API needs both:
   * one for the SSE response, one for citation validation and the query log.
   */
  complete(request: ChatRequest): Promise<string>;
}

export class ChatError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ChatError";
  }
}
