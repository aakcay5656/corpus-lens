import { notFound, redirect } from "next/navigation";
import { type Role } from "@corpus-lens/shared/role";
import { type User } from "@corpus-lens/shared/auth";

import { ApiError, apiFetch } from "./api";

/**
 * Who the current request belongs to, according to the API.
 *
 * The API is the authority, and deliberately so. The middleware in `middleware.ts` only
 * looks at whether a cookie is *present*, which is enough to avoid rendering a protected
 * page for an obviously-anonymous visitor but proves nothing — a forged or expired cookie
 * passes that check. Every actual decision goes through `/auth/me`, where the token is
 * verified against the signing key.
 *
 * This is the concrete meaning of "hiding a nav link is not authorization" (CLAUDE.md §9):
 * the functions below decide what to *render*, and the API independently refuses anything
 * the renderer got wrong.
 */
export async function getSession(): Promise<User | null> {
  try {
    const { user } = await apiFetch<{ user: User }>("/auth/me");
    return user;
  } catch (error) {
    // 401 is the ordinary "not logged in" answer, not a failure worth surfacing.
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** For pages that require a session. Redirects to login, preserving where to return to. */
export async function requireSession(returnTo?: string): Promise<User> {
  const user = await getSession();
  if (user === null) {
    const target =
      returnTo === undefined ? "/login" : `/login?next=${encodeURIComponent(returnTo)}`;
    redirect(target);
  }
  return user;
}

/**
 * For pages that require a role.
 *
 * A `USER` who types an admin URL gets a 404 rather than a 403 page. The API returns 403
 * — that is the honest answer to a request — but a UI that says "this exists and you may
 * not see it" confirms the route exists to someone probing for it, and there is nothing
 * the user can do with the information either way.
 */
export async function requireRole(role: Role, returnTo?: string): Promise<User> {
  const user = await requireSession(returnTo);
  if (user.role !== role) notFound();
  return user;
}
