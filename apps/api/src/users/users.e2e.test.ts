import "reflect-metadata";

import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerStorage } from "@nestjs/throttler";
import { type Database } from "@corpus-lens/db/client";
import { normalizeEmail } from "@corpus-lens/db/normalize-email";
import { hashPassword } from "@corpus-lens/db/password";
import { refreshTokens } from "@corpus-lens/db/schema/refresh-tokens";
import { users } from "@corpus-lens/db/schema/users";
import cookieParser from "cookie-parser";
import { and, eq, inArray, isNull } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module";
import { DATABASE } from "../database/database.module";

/**
 * User management, and specifically the rules that make it safe to expose: a `USER` cannot
 * reach it, an administrator cannot demote themselves, and a role change revokes the
 * target's sessions.
 *
 * That last one is the assertion easiest to leave out and hardest to notice missing —
 * without it a demoted account keeps a week-long path back to an admin access token, and
 * every other test still passes.
 *
 * The last-administrator refusal is only half-covered here; the reason is on that test.
 */
const ADMIN = { email: "users-e2e-admin@test.local", password: "users-e2e-admin-pw-1" };
const SECOND_ADMIN = { email: "users-e2e-admin2@test.local", password: "users-e2e-admin2-pw-1" };
const MEMBER = { email: "users-e2e-user@test.local", password: "users-e2e-user-pw-1" };
const ALL = [ADMIN.email, SECOND_ADMIN.email, MEMBER.email];

let app: INestApplication;
let db: Database;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    // This suite logs in four times; the login throttle is verified in its own file.
    .overrideProvider(ThrottlerStorage)
    .useValue({
      increment: (): Promise<{
        totalHits: number;
        timeToExpire: number;
        isBlocked: boolean;
        timeToBlockExpire: number;
      }> =>
        Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
    })
    .compile();

  app = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();

  db = app.get<Database>(DATABASE);

  await seed(ADMIN.email, ADMIN.password, "ADMIN");
  await seed(SECOND_ADMIN.email, SECOND_ADMIN.password, "ADMIN");
  await seed(MEMBER.email, MEMBER.password, "USER");
});

afterAll(async () => {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.email, ALL.map(normalizeEmail)));
  if (rows.length > 0) {
    await db.delete(refreshTokens).where(
      inArray(
        refreshTokens.userId,
        rows.map((row) => row.id),
      ),
    );
  }
  await db.delete(users).where(inArray(users.email, ALL.map(normalizeEmail)));
  await app.close();
});

async function seed(email: string, password: string, role: "ADMIN" | "USER"): Promise<void> {
  const passwordHash = await hashPassword(password);
  await db
    .insert(users)
    .values({ email: normalizeEmail(email), passwordHash, role })
    .onConflictDoUpdate({
      target: users.email,
      set: { passwordHash, role, updatedAt: new Date() },
    });
}

function http() {
  return request(app.getHttpServer());
}

async function login(credentials: { email: string; password: string }): Promise<string[]> {
  const response = await http().post("/auth/login").send(credentials).expect(200);
  return response.headers["set-cookie"] as unknown as string[];
}

async function idOf(email: string): Promise<string> {
  const row = await db.query.users.findFirst({ where: eq(users.email, normalizeEmail(email)) });
  if (row === undefined) throw new Error(`missing seeded user ${email}`);
  return row.id;
}

describe("user management authorization", () => {
  it("refuses a USER on the list with 403", async () => {
    const cookies = await login(MEMBER);
    await http().get("/users").set("Cookie", cookies).expect(403);
  });

  it("refuses a USER on the role change with 403", async () => {
    const cookies = await login(MEMBER);
    await http()
      .patch(`/users/${await idOf(MEMBER.email)}/role`)
      .set("Cookie", cookies)
      .send({ role: "ADMIN" })
      .expect(403);
  });

  it("lists accounts for an admin, without password hashes", async () => {
    const cookies = await login(ADMIN);
    const response = await http()
      .get("/users?search=users-e2e-&pageSize=50")
      .set("Cookie", cookies)
      .expect(200);

    const emails = (response.body.items as { email: string }[]).map((item) => item.email);
    expect(emails).toEqual(expect.arrayContaining(ALL.map(normalizeEmail)));
    expect(JSON.stringify(response.body)).not.toContain("$argon2");
  });
});

describe("role changes", () => {
  it("promotes a USER and revokes their existing sessions", async () => {
    const memberCookies = await login(MEMBER);
    const memberId = await idOf(MEMBER.email);

    const live = await db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, memberId), isNull(refreshTokens.revokedAt)));
    expect(live.length).toBeGreaterThan(0);

    const adminCookies = await login(ADMIN);
    await http()
      .patch(`/users/${memberId}/role`)
      .set("Cookie", adminCookies)
      .send({ role: "ADMIN" })
      .expect(200);

    // The access token they already hold still says USER until it expires — that is the
    // documented cost of stateless verification. What must not survive is the ability to
    // trade a refresh token for a *new* one.
    const stillLive = await db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, memberId), isNull(refreshTokens.revokedAt)));
    expect(stillLive).toHaveLength(0);

    await http().post("/auth/refresh").set("Cookie", memberCookies).expect(401);

    await http()
      .patch(`/users/${memberId}/role`)
      .set("Cookie", adminCookies)
      .send({ role: "USER" })
      .expect(200);
  });

  /**
   * The positive half of the last-administrator rule: demoting an admin while others
   * remain is allowed, so the guard is not simply refusing every demotion.
   *
   * The refusal itself is **not** asserted end to end, and the reason is worth stating
   * rather than hiding: these tests run against the same database as `pnpm db:seed`, which
   * always contains `admin@demo.local`, so the count can never reach zero here. Forcing it
   * would mean demoting every other administrator in the database and restoring them
   * afterwards — a test that leaves the developer's login broken if it fails halfway is a
   * worse trade than the coverage is worth. The rule is one `count` in `updateRole`.
   */
  it("allows demoting an administrator while others remain", async () => {
    const cookies = await login(ADMIN);
    const secondId = await idOf(SECOND_ADMIN.email);

    await http()
      .patch(`/users/${secondId}/role`)
      .set("Cookie", cookies)
      .send({ role: "USER" })
      .expect(200);

    await http()
      .patch(`/users/${secondId}/role`)
      .set("Cookie", cookies)
      .send({ role: "ADMIN" })
      .expect(200);
  });

  it("refuses an administrator changing their own role", async () => {
    const cookies = await login(ADMIN);
    await http()
      .patch(`/users/${await idOf(ADMIN.email)}/role`)
      .set("Cookie", cookies)
      .send({ role: "USER" })
      .expect(409);
  });

  it("rejects a role the schema does not define", async () => {
    const cookies = await login(ADMIN);
    await http()
      .patch(`/users/${await idOf(MEMBER.email)}/role`)
      .set("Cookie", cookies)
      .send({ role: "SUPERADMIN" })
      .expect(400);
  });

  it("answers 404 for a user that does not exist", async () => {
    const cookies = await login(ADMIN);
    await http()
      .patch("/users/00000000-0000-0000-0000-000000000000/role")
      .set("Cookie", cookies)
      .send({ role: "USER" })
      .expect(404);
  });
});
