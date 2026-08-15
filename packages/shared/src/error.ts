import { z } from "zod";

/**
 * The single error shape every failing request returns (CLAUDE.md §7).
 *
 * There is no `details` or `stack` field on purpose: the envelope cannot leak a SQL
 * string, a provider error body or a stack trace, because it has nowhere to put one. The
 * requestId is the handle a user quotes and the server correlates against its logs, which
 * is where the detail actually lives.
 */
export const errorCodeSchema = z.enum([
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  "INTERNAL",
]);

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    /** Safe to show a user. Never contains provider or database text. */
    message: z.string(),
    requestId: z.string(),
  }),
});

export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
