import { z } from "zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./limits";
import { roleSchema } from "./role";

/**
 * Tokens are deliberately absent from every response body below.
 *
 * The access and refresh JWTs travel in httpOnly cookies (CLAUDE.md §3), which means
 * JavaScript cannot read them and an XSS bug cannot exfiltrate them. Returning them in
 * the body as well would hand back exactly what the cookie flag exists to withhold.
 */

const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const loginRequestSchema = z.object({
  email: z.email(),
  /**
   * Only bounded, not shape-checked. Rejecting an existing password for failing a policy
   * it was created under locks the user out, and the policy belongs on registration.
   */
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

/** Registration is admin-only (CLAUDE.md §9), which is why it can set a role. */
export const registerRequestSchema = z.object({
  email: z.email(),
  password: passwordSchema,
  role: roleSchema.default("USER"),
});

/** The public view of a user. No password hash, no timestamps the client has no use for. */
export const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: roleSchema,
});

/** Login, refresh and /me all answer the same question: who am I now. */
export const sessionResponseSchema = z.object({
  user: userSchema,
  /** When the access token expires, so the client can refresh before a request fails. */
  accessTokenExpiresAt: z.iso.datetime(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type User = z.infer<typeof userSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
