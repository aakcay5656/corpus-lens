import { type AnswerResponse } from "@corpus-lens/shared/answer";
import { type ErrorEnvelope } from "@corpus-lens/shared/error";

/**
 * Reads the SSE stream from `POST /answer`.
 *
 * `EventSource` is not usable here: it only issues GET requests and cannot send a body or
 * carry the credentials option, and the question has to be POSTed. So the stream is read
 * from `fetch` directly, which means parsing the wire format by hand — four rules, the
 * same four the server's own provider parser implements:
 *
 *   1. frames are separated by a blank line
 *   2. a frame's `event:` names it, its `data:` carries the JSON
 *   3. anything else is ignored
 *   4. **a trailing partial frame is held until the next chunk completes it**
 *
 * Rule 4 is the one that matters. A network chunk boundary lands mid-JSON regularly, and
 * a parser that assumes whole frames works perfectly on localhost and drops tokens the
 * moment there is real latency between the two machines.
 */

export interface AnswerStreamHandlers {
  onToken: (token: string) => void;
  onResult: (result: AnswerResponse) => void;
}

export class AnswerStreamError extends Error {
  constructor(
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "AnswerStreamError";
  }
}

export async function streamAnswer(
  apiBaseUrl: string,
  body: { question: string; topK?: number },
  handlers: AnswerStreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
    signal,
  });

  // A failure before the stream opens is an ordinary HTTP error with the API's envelope —
  // a 401, a 429, or the 503 for an unconfigured chat model. Only once a 200 has been
  // written does the error arrive as a frame instead.
  if (!response.ok) throw await toStreamError(response);
  if (response.body === null) throw new AnswerStreamError("The server sent no response.", null);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Frames end with a blank line. Everything before the last one is complete; the
    // remainder stays buffered until more arrives.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) handleFrame(frame, handlers);
  }
}

function handleFrame(frame: string, handlers: AnswerStreamHandlers): void {
  let event = "message";
  let data = "";

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) data += line.slice("data:".length).trim();
  }

  if (data.length === 0) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    // A frame we cannot parse is dropped rather than failing the answer. Losing one token
    // degrades the display; aborting throws away an answer that is otherwise fine.
    return;
  }

  if (event === "token") {
    const token = (parsed as { token?: unknown }).token;
    if (typeof token === "string") handlers.onToken(token);
    return;
  }

  if (event === "result") {
    handlers.onResult(parsed as AnswerResponse);
    return;
  }

  if (event === "error") {
    const envelope = parsed as Partial<ErrorEnvelope>;
    throw new AnswerStreamError(
      envelope.error?.message ?? "The answer could not be generated.",
      envelope.error?.requestId ?? null,
    );
  }
}

async function toStreamError(response: Response): Promise<AnswerStreamError> {
  const requestId = response.headers.get("x-request-id");
  try {
    const body = (await response.json()) as Partial<ErrorEnvelope>;
    return new AnswerStreamError(
      body.error?.message ?? "The answer could not be generated.",
      body.error?.requestId ?? requestId,
    );
  } catch {
    return new AnswerStreamError("The answer could not be generated.", requestId);
  }
}
