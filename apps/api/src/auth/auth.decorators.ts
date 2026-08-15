import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { type Role } from "@corpus-lens/shared/role";
import { type Request } from "express";

/**
 * Route markers, read by the guards in `jwt-auth.guard.ts` and `roles.guard.ts`.
 *
 * The important design choice is the *direction* of the default. `JwtAuthGuard` is
 * registered globally and routes opt **out** with `@Public()`, rather than opting in with
 * an `@Auth()` decorator. CLAUDE.md §9 requires authorization on every route, and a
 * forgotten decorator should fail closed: with this arrangement, a new endpoint added in
 * Step 9 is authenticated by default and someone has to deliberately expose it.
 */

export const IS_PUBLIC_KEY = "auth:isPublic";

/** Login and refresh only. Every other route requires a valid access token. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = "auth:roles";

/** Restricts a route to the listed roles. Enforced by RolesGuard, server-side. */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
}

/**
 * Injects the user the guard already verified.
 *
 * Returns `undefined` rather than throwing on a public route, so the type at the call
 * site tells the truth about when a user is present instead of hiding it behind a
 * non-null assertion.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined =>
    context.switchToHttp().getRequest<Request>().user,
);
