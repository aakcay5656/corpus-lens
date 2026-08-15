import {
  CanActivate,
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { type Request } from "express";

import { IS_PUBLIC_KEY } from "./auth.decorators";
import { ACCESS_TOKEN_COOKIE } from "./cookies";
import { TokenService } from "./token.service";

/**
 * Authentication, registered globally in `app.module.ts`.
 *
 * Global registration is the whole point: CLAUDE.md §9 requires authorization on every
 * route, and the only reliable way to get that is to make it the default and require an
 * explicit `@Public()` to opt out. A route added later without any decorator is
 * authenticated; the failure mode of forgetting is a locked door, not an open one.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractToken(request);
    if (token === undefined) throw new UnauthorizedException("Authentication required.");

    try {
      const claims = await this.tokens.verifyAccessToken(token);
      request.user = { id: claims.sub, email: claims.email, role: claims.role };
      return true;
    } catch {
      // Expired, tampered with, or signed with the wrong secret — all one answer. Saying
      // which would tell an attacker whether a token is merely stale or entirely forged.
      throw new UnauthorizedException("Invalid or expired session.");
    }
  }
}

/**
 * The cookie is the primary carrier; the Authorization header is accepted as well.
 *
 * The browser uses the httpOnly cookie, which is what keeps the token out of reach of
 * JavaScript and therefore out of reach of an XSS bug. The header exists for the MCP
 * server and for `curl` in the README — non-browser clients that have no cookie jar and
 * are not subject to CSRF.
 */
function extractToken(request: Request): string | undefined {
  const cookie: unknown = request.cookies?.[ACCESS_TOKEN_COOKIE];
  if (typeof cookie === "string" && cookie.length > 0) return cookie;

  const header = request.header("authorization");
  if (header === undefined) return undefined;

  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value !== undefined && value.length > 0
    ? value
    : undefined;
}
