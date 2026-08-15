import { randomBytes } from "node:crypto";

import { ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { type Database } from "@corpus-lens/db/client";
import { normalizeEmail } from "@corpus-lens/db/normalize-email";
import { hashPassword, verifyPassword } from "@corpus-lens/db/password";
import { refreshTokens } from "@corpus-lens/db/schema/refresh-tokens";
import { users } from "@corpus-lens/db/schema/users";
import { type RegisterRequest, type User } from "@corpus-lens/shared/auth";
import { and, eq, isNull } from "drizzle-orm";

import { DATABASE } from "../database/database.module";
import { TokenService, hashRefreshToken } from "./token.service";

export interface IssuedSession {
  user: User;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Registration is admin-only — the controller enforces that with `@Roles("ADMIN")`.
   * This is a closed corpus of internal documentation, so self-signup would be a way for
   * anyone to read it (CLAUDE.md §9).
   */
  async register(input: RegisterRequest): Promise<User> {
    // The parking-lot item from Step 2. The unique constraint sits on the raw column
    // because Drizzle's upsert cannot target an expression, which makes this call the
    // only thing keeping Admin@demo.local and admin@demo.local one account.
    const email = normalizeEmail(input.email);

    const existing = await this.db.query.users.findFirst({ where: eq(users.email, email) });
    if (existing !== undefined) throw new ConflictException("That email is already registered.");

    const [created] = await this.db
      .insert(users)
      .values({ email, passwordHash: await hashPassword(input.password), role: input.role })
      .returning({ id: users.id, email: users.email, role: users.role });

    if (created === undefined) throw new Error("user insert returned no row");
    return created;
  }

  async login(rawEmail: string, password: string): Promise<IssuedSession> {
    // Normalised here too, for the same reason: a user who capitalises their email at the
    // login form would otherwise not be found at all.
    const email = normalizeEmail(rawEmail);
    const user = await this.db.query.users.findFirst({ where: eq(users.email, email) });

    // Verified even when the user does not exist, against a throwaway hash. Skipping the
    // work for an unknown email makes the response measurably faster, which turns login
    // into an account-enumeration oracle.
    const passwordMatches = await verifyPassword(
      user?.passwordHash ?? (await DUMMY_HASH_PROMISE),
      password,
    );

    if (user === undefined || !passwordMatches) {
      // One message for both cases, deliberately: "no such user" and "wrong password"
      // must be indistinguishable.
      throw new UnauthorizedException("Invalid email or password.");
    }

    return await this.issueSession({ id: user.id, email: user.email, role: user.role });
  }

  /**
   * Rotation with reuse detection.
   *
   * The presented token is invalidated and replaced on every successful refresh. If a
   * token that has *already* been rotated is presented again, one of two things is true:
   * either the legitimate client replayed an old token, or it was stolen and the thief is
   * using it. There is no way to tell which, so every session for that user is revoked
   * and both parties have to log in again. Failing loudly for the honest user is the
   * correct trade when the alternative is leaving an attacker with a live session.
   */
  async refresh(presentedToken: string): Promise<IssuedSession> {
    const tokenHash = hashRefreshToken(presentedToken);

    const stored = await this.db.query.refreshTokens.findFirst({
      where: eq(refreshTokens.tokenHash, tokenHash),
    });

    if (stored === undefined) throw new UnauthorizedException("Invalid session.");

    if (stored.revokedAt !== null) {
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException("Session reuse detected. Please log in again.");
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("Session expired. Please log in again.");
    }

    const user = await this.db.query.users.findFirst({ where: eq(users.id, stored.userId) });
    if (user === undefined) throw new UnauthorizedException("Invalid session.");

    const session = await this.issueSession({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    // Marked revoked *and* chained to its replacement, so a later reuse can be traced.
    await this.db
      .update(refreshTokens)
      .set({
        revokedAt: new Date(),
        replacedByTokenHash: hashRefreshToken(session.refreshToken),
      })
      .where(eq(refreshTokens.id, stored.id));

    return session;
  }

  /** Logout revokes the presented token only; other devices stay signed in. */
  async logout(presentedToken: string | undefined): Promise<void> {
    if (presentedToken === undefined) return;

    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.tokenHash, hashRefreshToken(presentedToken)),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }

  private async issueSession(user: User): Promise<IssuedSession> {
    const access = await this.tokens.signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    const refresh = this.tokens.createRefreshToken();

    await this.db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: refresh.tokenHash,
      expiresAt: refresh.expiresAt,
    });

    return {
      user,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt,
    };
  }

  private async revokeAllForUser(userId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }
}

/**
 * An argon2id hash of a random value nobody knows, verified against when the email is
 * unknown so that a failed login takes the same time whether or not the account exists.
 *
 * It is *computed*, not written down as a literal. A hard-coded string would have to be a
 * genuinely valid argon2 encoding to be worth anything: `verifyPassword` returns false
 * immediately on a malformed hash, which costs microseconds instead of the ~50ms a real
 * verification takes — and that difference is exactly the enumeration oracle this is
 * supposed to close. Computing it once at startup makes it impossible to get wrong.
 */
const DUMMY_HASH_PROMISE = hashPassword(randomBytes(32).toString("base64url"));
