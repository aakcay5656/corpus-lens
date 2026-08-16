import { z } from "zod";
import { paginationQuerySchema } from "./pagination";
import { roleSchema } from "./role";

/**
 * The admin user-management contract.
 *
 * Creation is deliberately **not** here: accounts are created through
 * `POST /auth/register`, which is already admin-only and already hashes, normalises and
 * checks for a duplicate email. A second create endpoint on this resource would be a
 * second copy of those four rules, and the copy is the one that would be forgotten when
 * one of them changes.
 */

export const userListQuerySchema = paginationQuerySchema.extend({
  /** Substring match on the email. Escaped server-side; see documents.service.ts. */
  search: z.string().trim().min(1).max(200).optional(),
  role: roleSchema.optional(),
});

export const userSummarySchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: roleSchema,
  createdAt: z.iso.datetime(),
  /**
   * Whether this account currently has a session that could be refreshed. Not "is online" —
   * it is the answer to "if I demote them, is there anything to revoke?", which is the
   * question an administrator is actually asking on this screen.
   */
  hasActiveSession: z.boolean(),
});

export const updateUserRoleRequestSchema = z.object({
  role: roleSchema,
});

export type UserListQuery = z.infer<typeof userListQuerySchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;
export type UpdateUserRoleRequest = z.infer<typeof updateUserRoleRequestSchema>;
