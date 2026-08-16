import { ChatError, type ChatProvider, type ChatRequest } from "./chat-provider";
import { redactSecrets } from "./redact";

/**
 * Text generation over the OpenAI `/v1/chat/completions` wire format, with SSE streaming.
 *
 * **Deviation from CLAUDE.md §3, recorded deliberately.** §3 specifies Anthropic Claude
 * "via official SDK". The model is still Claude — `anthropic/claude-sonnet-5` is the
 * default — but the transport is the OpenAI-compatible format rather than
 * `@anthropic-ai/sdk`. Three reasons:
 *
 *  1. The credential this is actually run with is an OpenRouter key, and OpenRouter does
 *     not expose Anthropic's `/v1/messages` endpoint.
 *  2. Step 6 already established this exact seam for embeddings. One wire format for both
 *     providers is one streaming parser and one retry policy to defend, not two.
 *  3. The `ChatProvider` interface §3 actually asks for is preserved unchanged, so
 *     dropping in an SDK-backed implementation is one new file and one factory branch.
 *
 * Same failure policy as the embedding provider: a bounded timeout and exactly one retry
 * on transient errors, written out rather than inherited from an SDK's defaults.
 */

export const DEFAULT_CHAT_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_CHAT_MODEL = "anthropic/claude-sonnet-5";

export interface OpenAiChatConfig {
  apiKey: string;
  model: string;
  /** Origin + path prefix, without a trailing slash. `/chat/completions` is appended. */
  baseUrl?: string;
  timeoutMs?: number;
}

export function createOpenAiChatProvider(config: OpenAiChatConfig): ChatProvider {
  const timeoutMs = config.timeoutMs ?? 60_000;

  return {
    model: config.model,
    mode: "model" as const,

    async complete(request: ChatRequest): Promise<string> {
      try {
        return await requestCompletion(request, config, timeoutMs);
      } catch (error) {
        if (!(error instanceof ChatError) || !error.retryable) throw error;
        // One retry. A user is waiting on this call, so a long backoff would be worse
        // than an honest error; and the request is not idempotent in cost terms, so
        // retrying more than once spends real money on a provider that is already sick.
        return await requestCompletion(request, config, timeoutMs);
      }
    },
  };
}

async function requestCompletion(
  request: ChatRequest,
  config: OpenAiChatConfig,
  timeoutMs: number,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl ?? DEFAULT_CHAT_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: request.messages,
        max_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        stream: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // The message carries no request detail on purpose: `config.apiKey` is in scope here.
    const reason = error instanceof Error ? error.name : "unknown error";
    throw new ChatError(`chat request failed to complete (${reason})`, true);
  }

  if (!response.ok) {
    const body = await readBodySafely(response);
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new ChatError(
      `chat request failed with ${response.status}: ${body}`,
      retryable,
      response.status,
    );
  }

  if (response.body === null) throw new ChatError("chat response had no body", false);

  return await readStream(response.body, request.onToken);
}

/**
 * Reads an SSE stream of `data: {json}` lines and assembles the text.
 *
 * Hand-parsed rather than pulled from a library because the format is four rules: split
 * on newlines, ignore anything that is not a `data:` line, stop at `[DONE]`, and hold a
 * trailing partial line until the next chunk completes it. That last rule is the one that
 * matters — a network chunk boundary lands mid-JSON regularly, and a parser that assumes
 * whole lines works locally and drops tokens under real latency.
 */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onToken: ((token: string) => void) | undefined,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let text = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Everything up to the last newline is complete; the remainder stays buffered.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const payload = trimmed.slice("data:".length).trim();
      if (payload === "[DONE]") continue;

      const token = extractToken(payload);
      if (token === null) continue;

      text += token;
      onToken?.(token);
    }
  }

  return text;
}

/** Shape of the one field we read from a streamed chunk. */
interface StreamChunk {
  choices?: { delta?: { content?: string } }[];
}

function extractToken(payload: string): string | null {
  let parsed: StreamChunk;
  try {
    parsed = JSON.parse(payload) as StreamChunk;
  } catch {
    // Gateways interleave keep-alive comments and non-JSON notices. Dropping one
    // unparseable frame is correct; failing the whole answer over it is not.
    return null;
  }
  return parsed.choices?.[0]?.delta?.content ?? null;
}

/** Provider error bodies echo credentials back. See `redact.ts`. */
async function readBodySafely(response: Response): Promise<string> {
  try {
    return redactSecrets(await response.text()).slice(0, 500);
  } catch {
    return "<unreadable body>";
  }
}
