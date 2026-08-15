import {
  CanActivate,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { type Role } from "@corpus-lens/shared/role";
import { type Request } from "express";

import { ROLES_KEY } from "./auth.decorators";

/**
 * Authorization. Runs after `JwtAuthGuard`, so `request.user` is already verified.
 *
 * This is the guard that makes the case's authorization requirement real: "hiding a nav
 * link is not authorization" (CLAUDE.md §9). The dashboard's navigation is irrelevant —
 * an admin route refuses a `USER` token here, on the server, whether the request came
 * from the UI, from curl, or from the MCP server.
 *
 * The distinction between 401 and 403 is kept honest: no user at all is "you are not
 * authenticated", a user with the wrong role is "you are, and you still may not".
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No @Roles() means any authenticated user; JwtAuthGuard has already had its say.
    if (required === undefined || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<Request>().user;
    if (user === undefined) throw new UnauthorizedException("Authentication required.");

    if (!required.includes(user.role)) {
      // Deliberately does not name the required role. It is not a secret, but telling a
      // caller exactly what they lack is free reconnaissance and buys them nothing they
      // could act on.
      throw new ForbiddenException("You do not have access to this resource.");
    }

    return true;
  }
}
