import "reflect-metadata";

import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { type Database } from "@corpus-lens/db/client";
import { normalizeEmail } from "@corpus-lens/db/normalize-email";
import { hashPassword } from "@corpus-lens/db/password";
import { users } from "@corpus-lens/db/schema/users";
import cookieParser from "cookie-parser";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module";
import { DATABASE } from "../database/database.module";

/**
 * That `/auth/login` is rate-limited, and that the limit is the endpoint's own rather than
 * the global one.
 *
 * This lives in its own file with its own application because the throttler counts per
 * process: the main auth suite logs in a dozen times and switches the guard off, so a
 * throttling assertion there would either fail or measure the wrong thing. Here the guard
 * is left exactly as production runs it.
 *
 * The attempts below all use a *wrong* password on purpose. That is the shape of the attack
 * being bounded — repeated failures against a known email — and it also means the test
 * cannot accidentally pass because the account was locked or the credentials were right.
 */

const VICTIM = { email: "throttle-victim@test.local", password: "throttle-victim-password-1" };

/** Must match the @Throttle on AuthController.login. */
const LOGIN_LIMIT = 10;

let app: INestApplication;
let db: Database;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  app = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();

  db = app.get<Database>(DATABASE);

  const passwordHash = await hashPassword(VICTIM.password);
  await db
    .insert(users)
    .values({ email: normalizeEmail(VICTIM.email), passwordHash, role: "USER" })
    .onConflictDoUpdate({
      target: users.email,
      set: { passwordHash, role: "USER", updatedAt: new Date() },
    });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.email, normalizeEmail(VICTIM.email)));
  await app.close();
});

describe("login rate limiting", () => {
  it("stops guessing after the endpoint's own limit, well below the global ceiling", async () => {
    const http = () => request(app.getHttpServer());
    const statuses: number[] = [];

    // One more than the limit, sequentially — the throttler counts requests, and firing
    // them concurrently would test the storage's race behaviour rather than the limit.
    for (let attempt = 0; attempt < LOGIN_LIMIT + 1; attempt += 1) {
      const response = await http()
        .post("/auth/login")
        .send({ email: VICTIM.email, password: "wrong-password-entirely" });
      statuses.push(response.status);
    }

    // Every attempt up to the limit is answered on its merits: wrong password, 401.
    expect(statuses.slice(0, LOGIN_LIMIT)).toEqual(Array<number>(LOGIN_LIMIT).fill(401));

    // The one past it is refused without the password being checked at all.
    expect(statuses[LOGIN_LIMIT]).toBe(429);

    // The global limit is 120/minute (app.module.ts). Tripping at 11 proves the endpoint's
    // own @Throttle is what answered — this test would pass on the global limit alone only
    // if it made 121 requests.
    expect(LOGIN_LIMIT + 1).toBeLessThan(120);
  });

  it("answers a throttled request in the standard error envelope, not with a class name", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: VICTIM.email, password: "wrong-password-entirely" });

    // Still inside the window opened by the previous test.
    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({
      error: { code: "RATE_LIMITED", message: expect.any(String) as unknown as string },
    });
    // The default ThrottlerGuard message is the literal "ThrottlerException: Too Many
    // Requests" — an internal class name rendered to a user.
    expect(response.body.error.message).not.toContain("ThrottlerException");
  });
});
