import { createHash, randomBytes } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { type Role } from "@corpus-lens/shared/role";

import { apiEnv } from "../config/env";

/**
 * Minting and verifying the two tokens.
 *
 * They are deliberately different kinds of thing:
 *
 * - The **access token** is a signed JWT and nothing else. Verifying it is a signature
 *   check with no database round trip, which is what makes it cheap enough to put on
 *   every request. The price is that it cannot be revoked before it expires, which is why
 *   its lifetime is 15 minutes rather than a day.
 *
 * - The **refresh token** is opaque random bytes, stored hashed. It is not a JWT, because
 *   a JWT would tempt someone to trust its claims without a lookup — and the lookup *is*
 *   the feature here: it is what allows rotation, revocation and reuse detection.
 */

export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: Role;
}

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  async signAccessToken(user: AccessTokenClaims): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + apiEnv.ACCESS_TOKEN_TTL_SECONDS * 1000);
    const token = await this.jwt.signAsync(
      { email: user.email, role: user.role },
      {
        subject: user.sub,
        secret: apiEnv.JWT_ACCESS_SECRET,
        expiresIn: apiEnv.ACCESS_TOKEN_TTL_SECONDS,
      },
    );
    return { token, expiresAt };
  }

  /**
   * Throws when the token is expired, tampered with, or signed with the *refresh* secret.
   * That last case is the reason the two secrets must differ: without it, a refresh token
   * would verify here and be accepted as an access token.
   */
  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const payload = await this.jwt.verifyAsync<{ sub: string; email: string; role: Role }>(token, {
      secret: apiEnv.JWT_ACCESS_SECRET,
    });
    return { sub: payload.sub, email: payload.email, role: payload.role };
  }

  /**
   * 256 bits from the CSPRNG. Not a JWT and not a UUID: it carries no claims to be
   * trusted and needs no structure, only enough entropy that guessing is hopeless.
   */
  createRefreshToken(): { token: string; tokenHash: string; expiresAt: Date } {
    const token = randomBytes(32).toString("base64url");
    return {
      token,
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(Date.now() + apiEnv.REFRESH_TOKEN_TTL_SECONDS * 1000),
    };
  }
}

/**
 * SHA-256, not argon2 — the opposite of the choice made for passwords, for a specific
 * reason. Argon2's cost exists to make guessing a human-chosen secret expensive. This
 * value is 256 bits of server-generated randomness, so there is nothing to guess, and a
 * deliberately slow hash would only add latency to every refresh.
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
