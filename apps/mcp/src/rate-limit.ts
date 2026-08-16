/**
 * A fixed-window rate limiter for the MCP endpoint.
 *
 * **Why this exists.** The API throttles `/search` to 30 requests a minute and `/answer` to
 * 10, because both spend money per call — an embedding request and a generation request
 * respectively (CLAUDE.md §9). `search_corpus` calls the *same* embedding provider through
 * the same `retrieve()`, and this server had no limit at all. Rate-limiting one front door
 * and leaving the other open bounds nothing: an attacker uses the open one.
 *
 * **Keyed by caller, not by IP.** The API throttles on IP because it serves a browser and
 * has no identity before the guard runs. Here every request is authenticated *before* this
 * is consulted, so the natural key is the caller id — which is both more accurate (one
 * account behind a shared NAT is one budget) and harder to evade (a new IP is free, a new
 * account is not: registration is admin-only).
 *
 * **In memory, deliberately.** CLAUDE.md §3 rules out Redis, and this server is a single
 * process. The honest limitation: run two instances behind a load balancer and each keeps
 * its own counter, so the effective limit doubles. That is a deployment-shaped problem with
 * a deployment-shaped answer (a shared store), and pretending otherwise by writing a
 * distributed limiter nobody asked for would be worse than naming it here.
 *
 * **Fixed window, not a sliding one.** A fixed window admits up to 2× the limit across a
 * window boundary. That is a known and accepted property: the limit exists to bound cost
 * and stop a runaway loop, not to meter a paid API to the request. A sliding window costs a
 * timestamp list per caller for a precision nothing here needs.
 */

export interface RateLimitOptions {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  now?: () => number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Whole seconds until the current window resets — what a `Retry-After` header wants. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check: (key: string) => RateLimitDecision;
}

/**
 * The MCP protocol is chattier than one HTTP call per user action: a client initialises,
 * lists tools, then calls one. So the budget is set above the API's 30/minute for search
 * even though the expensive operation is the same — it is counted at the request level, and
 * counting protocol traffic against a search budget would reject legitimate clients.
 */
export const DEFAULT_MCP_RATE_LIMIT = 60;
export const DEFAULT_MCP_RATE_WINDOW_MS = 60_000;

interface Window {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const now = options.now ?? (() => Date.now());
  const windows = new Map<string, Window>();

  return {
    check(key: string): RateLimitDecision {
      const current = now();
      const window = windows.get(key);

      if (window === undefined || current >= window.resetAt) {
        // Expired entries are replaced on the owner's next request rather than swept by a
        // timer. The map is bounded by the number of *accounts*, not by traffic, and
        // registration is admin-only — so it cannot be grown by an attacker, which is what
        // a periodic sweep would be defending against.
        windows.set(key, { count: 1, resetAt: current + options.windowMs });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (window.count >= options.limit) {
        return {
          allowed: false,
          // Rounded up: reporting 0 would invite an immediate retry that is certain to fail.
          retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - current) / 1000)),
        };
      }

      window.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
