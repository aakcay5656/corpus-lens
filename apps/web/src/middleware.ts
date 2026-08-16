import { NextResponse, type NextRequest } from "next/server";
import { type Role } from "@corpus-lens/shared/role";

/**
 * Route protection, resolved before anything renders.
 *
 * The first version of this file only checked whether an access cookie was *present* and
 * left the real decision to the pages. Two things were wrong with that, both found by
 * running it:
 *
 * 1. **A check in a layout does not stop the page below it from rendering.** React
 *    receives `children` as already-constructed elements, so a `requireRole` in a layout
 *    runs *alongside* the page rather than before it — the dashboard's content was
 *    rendered and serialised into the payload sent to a `USER`, even though the layout
 *    had called `notFound()`.
 * 2. **`notFound()` cannot set a 404 once the response has begun streaming.** A
 *    `loading.tsx` creates a Suspense boundary, the shell flushes, the status line is
 *    already written — and the not-found page arrives with a 200.
 *
 * So the decision is made here, where no rendering has started and the status is still
 * ours to choose. And it is a *verified* decision rather than a guess: this asks the API,
 * which holds the signing key. The cost is one request per navigation, which is the
 * honest price of not duplicating the secret into a second process.
 *
 * The API still enforces its own guards on every endpoint. Nothing here is load-bearing
 * for security — it decides what to render, and the API independently refuses whatever
 * this gets wrong (CLAUDE.md §9).
 */
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

/** The only paths reachable without a session. */
const PUBLIC_PATHS = new Set(["/login"]);

/** Path prefixes that additionally require ADMIN. Mirrors the API's `@Roles("ADMIN")`. */
const ADMIN_PREFIXES = ["/dashboard"];

interface SessionUser {
  role: Role;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const user = await resolveSession(request);

  if (PUBLIC_PATHS.has(pathname)) {
    if (user === null) return NextResponse.next();
    // Already signed in: skip the form and go where they were headed.
    const next = request.nextUrl.searchParams.get("next");
    return NextResponse.redirect(new URL(isSafeReturnPath(next) ? next : "/chat", request.url));
  }

  if (user === null) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  if (ADMIN_PREFIXES.some((prefix) => pathname.startsWith(prefix)) && user.role !== "ADMIN") {
    // Redirected rather than shown a 403 page. There is nothing a `USER` can do with the
    // knowledge that the route exists, and sending them somewhere they *can* use is more
    // helpful than an error. The API returns a real 403 to anything that asks it directly.
    return NextResponse.redirect(new URL("/chat", request.url));
  }

  return NextResponse.next();
}

/**
 * Asks the API who this request belongs to.
 *
 * Returns null for "no valid session" — which covers an absent cookie, an expired token,
 * a forged one, and the API being unreachable. Treating an unreachable API as
 * unauthenticated is the fail-closed choice: the alternative is rendering a protected
 * shell whose every data request will fail anyway.
 */
async function resolveSession(request: NextRequest): Promise<SessionUser | null> {
  const cookie = request.headers.get("cookie");
  if (cookie === null || !cookie.includes("cl_access=")) return null;

  try {
    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { user?: SessionUser };
    return body.user ?? null;
  } catch {
    return null;
  }
}

/**
 * Only same-site absolute paths are honoured as a return target.
 *
 * `?next=https://evil.example` would otherwise make the login page an open redirect: a
 * link on our domain that authenticates the user and then hands them to someone else's
 * site carrying the trust of having just signed in.
 */
function isSafeReturnPath(value: string | null): value is string {
  return value !== null && value.startsWith("/") && !value.startsWith("//");
}

export const config = {
  // Everything except Next's own assets and the icons.
  //
  // Listing what to skip rather than what to cover means a page added later is protected
  // by default. The exclusions are named individually rather than matched by extension,
  // because a blanket "anything with a dot" would also let through any future route
  // handler whose path happened to contain one.
  //
  // `icon.svg` is here because it was missing and the tab icon silently 404'd — the
  // middleware answered it with a 307 to /login, and a browser will not render a redirect
  // as an image. It only showed up by requesting the file rather than trusting that Next
  // "handles icons".
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|robots.txt).*)"],
};
