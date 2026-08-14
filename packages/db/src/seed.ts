import { createDatabase } from "./client";
import { env } from "./env";
import { normalizeEmail } from "./normalize-email";
import { hashPassword } from "./password";
import { users } from "./schema/users";

interface DemoUser {
  email: string;
  password: string;
  role: "USER" | "ADMIN";
}

/**
 * Seeds the two demo accounts the README hands to a reviewer.
 *
 * Idempotent: re-running resets the password and role of an existing account rather than
 * inserting a duplicate or failing on the unique index. That matters because the setup in
 * the README ends with `pnpm db:seed`, and a reviewer who runs it twice should not see an
 * error — or, worse, be left with a password they cannot log in with.
 */
async function upsertDemoUser(
  db: ReturnType<typeof createDatabase>["db"],
  demoUser: DemoUser,
): Promise<"created" | "updated"> {
  const passwordHash = await hashPassword(demoUser.password);
  const email = normalizeEmail(demoUser.email);

  // Upsert rather than check-then-insert: the latter races two concurrent seeds against
  // the unique index, and this is the statement a reviewer may well run twice.
  const result = await db
    .insert(users)
    .values({ email, passwordHash, role: demoUser.role })
    .onConflictDoUpdate({
      target: users.email,
      set: { passwordHash, role: demoUser.role, updatedAt: new Date() },
    })
    .returning({ createdAt: users.createdAt, updatedAt: users.updatedAt });

  const row = result[0];
  if (row === undefined) {
    throw new Error(`Seeding ${demoUser.email} returned no row`);
  }

  // On a fresh insert both timestamps come from the same statement; on an update only
  // updatedAt moves. Comparing them is cheaper than a second round trip.
  return row.createdAt.getTime() === row.updatedAt.getTime() ? "created" : "updated";
}

async function main(): Promise<void> {
  const demoUsers: DemoUser[] = [
    { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD, role: "ADMIN" },
    { email: env.SEED_USER_EMAIL, password: env.SEED_USER_PASSWORD, role: "USER" },
  ];

  const { db, close } = createDatabase({ url: env.DATABASE_URL, maxConnections: 1 });

  try {
    for (const demoUser of demoUsers) {
      const outcome = await upsertDemoUser(db, demoUser);
      // Never log the password itself (CLAUDE.md §9) — the README carries it instead.
      console.log(`  ${outcome.padEnd(7)} ${demoUser.role.padEnd(5)} ${demoUser.email}`);
    }

    console.log("Seed complete. Credentials are in .env / .env.example.");
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
