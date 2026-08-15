import { EmbeddingError, type EmbeddingProvider } from "./embeddings";

/**
 * Embeddings over the OpenAI `/v1/embeddings` wire format, via plain `fetch`.
 *
 * Why not the `openai` SDK: this is one POST to one endpoint, and the thing that has to
 * be demonstrable here is the failure policy — a bounded timeout and exactly one retry
 * on transient errors (CLAUDE.md §7). The SDK ships its own retry and timeout defaults,
 * so using it would mean either inheriting a policy I did not choose or configuring it
 * off and writing this anyway. Roughly fifty lines of `fetch` is the smaller thing to
 * own and defend.
 *
 * The base URL is configurable because that wire format is not exclusive to OpenAI —
 * OpenRouter, Azure OpenAI and a self-hosted vLLM all speak it. One env var is the whole
 * cost of not being locked to one vendor, and it was not hypothetical: the key this was
 * first run against was an OpenRouter key.
 */

export const DEFAULT_EMBEDDINGS_BASE_URL = "https://api.openai.com/v1";

export interface OpenAiEmbeddingConfig {
  apiKey: string;
  model: string;
  dimensions: number;
  /** Origin + path prefix, without a trailing slash. `/embeddings` is appended. */
  baseUrl?: string;
  timeoutMs?: number;
}

/** Shape of the fields we read from a successful response. */
interface EmbeddingsResponseBody {
  data?: { index?: number; embedding?: number[] }[];
}

export function createOpenAiEmbeddingProvider(config: OpenAiEmbeddingConfig): EmbeddingProvider {
  const timeoutMs = config.timeoutMs ?? 30_000;

  return {
    model: config.model,
    dimensions: config.dimensions,
    // Documented limits of the text-embedding-3 family. They live here rather than at
    // the call site because they are facts about this provider, not about ingestion.
    maxInputTokens: 8191,
    maxRequestTokens: 300_000,
    maxBatchSize: 2048,

    async embedBatch(texts: string[]): Promise<number[][]> {
      try {
        return await requestEmbeddings(texts, config, timeoutMs);
      } catch (error) {
        if (!(error instanceof EmbeddingError) || !error.retryable) throw error;
        // One retry, not a loop: ingestion is restartable and re-runs skip unchanged
        // documents by content hash, so a persistent outage is better surfaced than
        // absorbed by a long backoff nobody is watching.
        return await requestEmbeddings(texts, config, timeoutMs);
      }
    },
  };
}

async function requestEmbeddings(
  texts: string[],
  config: OpenAiEmbeddingConfig,
  timeoutMs: number,
): Promise<number[][]> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl ?? DEFAULT_EMBEDDINGS_BASE_URL}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: config.model,
        dimensions: config.dimensions,
      }),
      // An unbounded request can hang the whole ingestion run behind one stalled socket.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // Connection refused, DNS failure and the timeout above all land here, and all three
    // are worth one more attempt. The message deliberately carries no request detail:
    // `config.apiKey` is in scope and must never reach a log line (CLAUDE.md §9).
    const reason = error instanceof Error ? error.name : "unknown error";
    throw new EmbeddingError(`embedding request failed to complete (${reason})`, true);
  }

  if (!response.ok) {
    const body = await readBodySafely(response);
    // 408/429 and 5xx are transient; a 400 means the request itself is wrong and
    // repeating it verbatim would only spend the same quota twice.
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new EmbeddingError(
      `embedding request failed with ${response.status}: ${body}`,
      retryable,
    );
  }

  const body = (await response.json()) as EmbeddingsResponseBody;
  const data = body.data;
  if (data === undefined || data.length !== texts.length) {
    throw new EmbeddingError(
      `embedding response held ${data?.length ?? 0} vectors for ${texts.length} inputs`,
      false,
    );
  }

  // The API documents that results may be returned out of order, so they are placed by
  // their own `index` rather than trusted to arrive sorted.
  const vectors = new Array<number[] | undefined>(texts.length);
  for (const entry of data) {
    const index = entry.index;
    const embedding = entry.embedding;
    if (index === undefined || embedding === undefined || index >= texts.length) {
      throw new EmbeddingError("embedding response contained a malformed entry", false);
    }
    vectors[index] = embedding;
  }

  return vectors.map((vector, index) => {
    if (vector === undefined) {
      throw new EmbeddingError(`embedding response had no vector for input ${index}`, false);
    }
    return vector;
  });
}

/**
 * Error bodies are worth keeping — a 400 is undiagnosable without one — but not verbatim.
 *
 * The original version of this comment claimed provider error bodies "contain no
 * secrets". That was wrong, and a real 401 proved it: the response echoes the API key
 * back, partially masked but with its real last four characters, and this string is
 * stored in `ingestion_events.message` and rendered in the admin dashboard. CLAUDE.md §9
 * says never log an API key, and a partial key is still a key.
 *
 * So anything that looks like a credential is scrubbed before the body is kept. The body
 * stays server-side regardless — the API's exception filter is what stops it reaching a
 * client (CLAUDE.md §7) — but defence in depth is the point when the alternative is
 * writing key material to a table.
 */
async function readBodySafely(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return redactSecrets(text).slice(0, 500);
  } catch {
    return "<unreadable body>";
  }
}

/**
 * Replaces anything shaped like an API key. Deliberately broad: it matches the masked
 * forms providers echo back (`sk-or-v1***...73bf`) as well as whole keys, because the
 * cost of over-redacting an error message is a slightly less useful log line and the cost
 * of under-redacting it is a credential in the database.
 */
function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9._*-]{8,}/g, "$1-<redacted>")
    .replace(/\bBearer\s+[A-Za-z0-9._*-]{8,}/gi, "Bearer <redacted>");
}
