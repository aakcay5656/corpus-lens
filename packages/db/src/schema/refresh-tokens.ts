import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * One row per issued refresh token, which is what makes rotation real rather than
 * nominal.
 *
 * A refresh token could be a self-contained JWT with no server state at all, and rotation
 * would still "work" in the sense that each refresh mints a new one. But nothing would be
 * revocable and, more importantly, nothing would notice **reuse**: if a token is stolen,
 * both the attacker and the victim hold a valid credential and the theft is undetectable.
 *
 * Storing the tokens lets the refresh endpoint apply the standard rule — a token that has
 * already been rotated must never be accepted again, and an attempt to do so means one of
 * the two holders is an attacker. Since we cannot tell which, the whole family is revoked
 * and both are forced to log in.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /**
     * SHA-256 of the token, never the token itself. A leaked database dump must not hand
     * over working sessions. Argon2 is not used here, unlike passwords: this value is
     * 256 bits of server-generated randomness rather than something a human chose, so
     * there is nothing for a brute-force to exploit and a per-request KDF would only add
     * latency to every refresh.
     */
    tokenHash: text("token_hash").notNull().unique(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    /** Set when the token is rotated away or revoked. Null means currently valid. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    /**
     * The token this one was rotated into. Chains the family together so that presenting
     * an already-rotated token can revoke every descendant, not just itself.
     */
    replacedByTokenHash: text("replaced_by_token_hash"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Revoking every session for one user, on reuse detection or on password change.
    index("refresh_tokens_user_id_idx").on(table.userId),
    // The cleanup query for expired rows.
    index("refresh_tokens_expires_at_idx").on(table.expiresAt),
  ],
);
