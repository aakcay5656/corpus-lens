import { cookies } from "next/headers";
import { type ErrorEnvelope } from "@corpus-lens/shared/error";

/**
 * Calling the API from a Server Component.
 *
 * The session lives in an httpOnly cookie, which by design JavaScript cannot read — so a
 * server-rendered page cannot just fetch and hope. It has to take the cookies off the
 * incoming request and put them on the outgoing one, which is what `forwardCookies` does.
 *
 * This is also why the app renders on the server by default: the browser never needs the
 * token, never sees it, and there is no window in which an unauthenticated shell is
 * painted before a client-side check redirects.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function forwardCookies(): Promise<string> {
  const store = await cookies();
  return store
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  /**
   * Server-render caching. Defaults to "no-store": every page here shows either the
   * caller's own session or live operational data, and a cached response would show one
   * user's dashboard to another.
   */
  cache?: RequestCache;
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      cookie: await forwardCookies(),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: options.cache ?? "no-store",
  });

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

/**
 * Turns a failed response into a typed error, reading the API's own envelope.
 *
 * The envelope is the same shape everywhere (`packages/shared/src/error.ts`), so the UI
 * gets a code it can branch on and a message that is already safe to display — the API
 * has guaranteed it contains no SQL, no stack and no provider text.
 */
async function toApiError(response: Response): Promise<ApiError> {
  let code = "INTERNAL";
  let message = "Something went wrong.";
  let requestId: string | null = response.headers.get("x-request-id");

  try {
    const body = (await response.json()) as Partial<ErrorEnvelope>;
    if (body.error !== undefined) {
      code = body.error.code;
      message = body.error.message;
      requestId = body.error.requestId ?? requestId;
    }
  } catch {
    // A non-JSON error body (a proxy's HTML 502 page, say) leaves the defaults in place.
    // There is nothing useful to salvage and guessing would only produce noise.
  }

  return new ApiError(response.status, code, message, requestId);
}
