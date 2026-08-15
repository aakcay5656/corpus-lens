import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import {
  loginRequestSchema,
  registerRequestSchema,
  type SessionResponse,
  type User,
} from "@corpus-lens/shared/auth";
import { type Request, type Response } from "express";

import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser, Public, Roles, type AuthenticatedUser } from "./auth.decorators";
import { AuthService, type IssuedSession } from "./auth.service";
import {
  REFRESH_TOKEN_COOKIE,
  clearAuthCookies,
  setAccessCookie,
  setRefreshCookie,
} from "./cookies";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Admin-only, not public. This is a closed corpus of internal documentation; open
   * self-registration would be a way for anyone to read it (CLAUDE.md §9).
   */
  @Post("register")
  @Roles("ADMIN")
  async register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: unknown,
  ): Promise<{ user: User }> {
    const input = body as Parameters<AuthService["register"]>[0];
    return { user: await this.auth.register(input) };
  }

  @Post("login")
  @Public()
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const input = body as { email: string; password: string };
    const session = await this.auth.login(input.email, input.password);
    return respondWithSession(response, session);
  }

  /**
   * Public in the sense that no *access* token is required — the refresh cookie is the
   * credential. It has to be reachable without a valid access token, since needing a new
   * one is the entire reason for calling it.
   */
  @Post("refresh")
  @Public()
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const presented: unknown = request.cookies?.[REFRESH_TOKEN_COOKIE];
    if (typeof presented !== "string" || presented.length === 0) {
      throw new UnauthorizedException("No session to refresh.");
    }
    return respondWithSession(response, await this.auth.refresh(presented));
  }

  @Post("logout")
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const presented: unknown = request.cookies?.[REFRESH_TOKEN_COOKIE];
    await this.auth.logout(typeof presented === "string" ? presented : undefined);
    // Cleared unconditionally. Logging out must succeed even when the token was already
    // invalid, or a user with a broken session can never get rid of it.
    clearAuthCookies(response);
  }

  /** Who am I. Requires a valid access token, like every route without `@Public()`. */
  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser | undefined): { user: AuthenticatedUser } {
    if (user === undefined) throw new UnauthorizedException("Authentication required.");
    return { user };
  }
}

/**
 * Sets both cookies and returns the session body.
 *
 * The body carries the user and the access-token expiry, and **no tokens** — they are in
 * httpOnly cookies, and repeating them here would hand back exactly what that flag exists
 * to withhold (packages/shared/src/auth.ts). The expiry is included so the client can
 * refresh proactively instead of discovering the problem through a failed request.
 */
function respondWithSession(response: Response, session: IssuedSession): SessionResponse {
  setAccessCookie(response, session.accessToken, session.accessTokenExpiresAt);
  setRefreshCookie(response, session.refreshToken, session.refreshTokenExpiresAt);

  return {
    user: session.user,
    accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
  };
}
