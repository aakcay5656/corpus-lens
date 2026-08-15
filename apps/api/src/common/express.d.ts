import { type Role } from "@corpus-lens/shared/role";

/**
 * The two properties this API attaches to a request.
 *
 * Declared here rather than cast at each use site so that `request.user` is typed
 * everywhere and cannot be read on a route that has no guard — the type says it may be
 * undefined, which is exactly the state of affairs on a `@Public()` route.
 */
declare global {
  namespace Express {
    interface Request {
      /** Set by RequestIdMiddleware on every request, without exception. */
      requestId: string;
      /** Set by JwtAuthGuard. Undefined on public routes. */
      user?: { id: string; email: string; role: Role };
    }
  }
}

export {};
