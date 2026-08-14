/**
 * The single place an email address is put into canonical form before it touches the
 * database.
 *
 * Email addresses are treated as case-insensitive by every mail provider in practice, so
 * Admin@demo.local and admin@demo.local must be one account. The alternative — a unique
 * index on lower(email) — is enforced by the database rather than by convention, but
 * Drizzle's upsert can only target a column, not an expression, so the choice is between
 * normalising here or dropping to raw SQL for every insert.
 *
 * Normalising at the write boundary is the cheaper of the two, on the condition that
 * every write goes through this function. Step 8's auth module must call it on login too,
 * or a user who capitalises their email will not be found.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
