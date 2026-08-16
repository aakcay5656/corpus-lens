import { z } from "zod";

/**
 * The two roles from CLAUDE.md §9. USER may search and ask; ADMIN additionally reads the
 * dashboard, manages documents and triggers ingestion.
 *
 * The literal values match the `user_role` enum in packages/db. They are duplicated
 * rather than imported because packages/shared must stay free of a database dependency —
 * it is consumed by the browser. A mismatch surfaces the first time the API maps a row to
 * a DTO, which is why that mapping is the only place the two meet.
 */
export const roleSchema = z.enum(["USER", "ADMIN"]);

/**
 * The roles as a list, read off the schema rather than written a second time — a UI that
 * offers a role the validator rejects is a bug nothing else would catch.
 */
export const ROLES = roleSchema.options;

export type Role = z.infer<typeof roleSchema>;
