import { type CookieOptions, type Response } from "express";

import { apiEnv } from "../config/env";

/**
 * Where the tokens live, and why each flag is set.
 *
 * CLAUDE.md §3 puts the tokens in httpOnly cookies. Each option below closes a specific
 * hole, so they are worth naming individually rather than copying as a block:
 *
 * - `httpOnly` — JavaScript cannot read the cookie, so an XSS bug cannot exfiltrate the
 *   session. This is the reason the login response body carries no tokens: returning them
 *   there would hand back precisely what this flag withholds.
 * - `sameSite: "lax"` — the browser will not attach the cookie to a cross-site POST, which
 *   is the CSRF vector. "lax" rather than "strict" so that following a link into the app
 *   still arrives logged in.
 * - `secure` in production only — a browser silently discards a Secure cookie sent over
 *   plain http, and local development is plain http. Hard-coding it either way breaks one
 *   of the two environments.
 * - `path` on the refresh cookie — it is sent only to the refresh endpoint, so the
 *   long-lived credential is not attached to every ordinary API call.
 */

export const ACCESS_TOKEN_COOKIE = "cl_access";
export const REFRESH_TOKEN_COOKIE = "cl_refresh";

/** Refresh is the only route that needs the refresh cookie, so it is the only one that gets it. */
export const REFRESH_COOKIE_PATH = "/auth/refresh";

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: apiEnv.NODE_ENV === "production",
  };
}

export function setAccessCookie(response: Response, token: string, expiresAt: Date): void {
  response.cookie(ACCESS_TOKEN_COOKIE, token, {
    ...baseOptions(),
    path: "/",
    expires: expiresAt,
  });
}

export function setRefreshCookie(response: Response, token: string, expiresAt: Date): void {
  response.cookie(REFRESH_TOKEN_COOKIE, token, {
    ...baseOptions(),
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
  });
}

/**
 * Cleared with the same flags and path they were set with. A browser matches cookies for
 * deletion on name, domain and path, so clearing with a different path leaves the cookie
 * in place and logout silently does nothing.
 */
export function clearAuthCookies(response: Response): void {
  response.clearCookie(ACCESS_TOKEN_COOKIE, { ...baseOptions(), path: "/" });
  response.clearCookie(REFRESH_TOKEN_COOKIE, { ...baseOptions(), path: REFRESH_COOKIE_PATH });
}
