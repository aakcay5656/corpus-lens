import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { userRole } from "./enums";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),

  /**
   * Always stored lower-cased — see normalize-email.ts. The unique constraint is on the
   * column itself rather than on lower(email) so that an upsert can target it; that makes
   * the normalisation step load-bearing, not cosmetic.
   */
  email: text("email").notNull().unique(),

  /**
   * argon2id output in PHC string format. The encoded hash carries its own salt and cost
   * parameters, so raising the parameters later does not invalidate existing rows.
   */
  passwordHash: text("password_hash").notNull(),

  role: userRole("role").notNull().default("USER"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
