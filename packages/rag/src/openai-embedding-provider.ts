import { EmbeddingError, type EmbeddingProvider } from "./embeddings";

/**
 * OpenAI embeddings over plain `fetch`.
 *
 * Why not the `openai` SDK: this is one POST to one endpoint, and the thing that has to
 * be demonstrable here is the failure policy — a bounded timeout and exactly one retry
 * on transient errors (CLAUDE.md §7). The SDK ships its own retry and timeout defaults,
 * so using it would mean either inheriting a policy I did not choose or configuring it
 * off and writing this anyway. Roughly fifty lines of `fetch` is the smaller thing to
 * own and defend.
 */

const EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

export interface OpenAiEmbeddingConfig {
  apiKey: string;
  model: string;
  dimensions: number;
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
    response = await fetch(EMBEDDINGS_URL, {
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
 * Error bodies help diagnose a 400 and OpenAI's contain no secrets, so a truncated body
 * is kept. It stays server-side: the API's exception filter is what stops any of this
 * reaching a client (CLAUDE.md §7).
 */
async function readBodySafely(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "<unreadable body>";
  }
}
