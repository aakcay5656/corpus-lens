import "reflect-metadata";

import { Controller, Get, type INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { type Database } from "@corpus-lens/db/client";
import { normalizeEmail } from "@corpus-lens/db/normalize-email";
import { hashPassword } from "@corpus-lens/db/password";
import { users } from "@corpus-lens/db/schema/users";
import cookieParser from "cookie-parser";
import { inArray, like } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ThrottlerStorage } from "@nestjs/throttler";

import { AppModule } from "../app.module";
import { apiEnv } from "../config/env";
import { DATABASE } from "../database/database.module";
import { Public, Roles } from "./auth.decorators";

/**
 * The two tests PLAN.md Step 8 and CLAUDE.md §9 require by name — a `USER` token gets 403
 * from an admin route, and an expired token gets 401 — plus the claim underneath them,
 * which is that no route is reachable unauthenticated except login, refresh and logout.
 *
 * These run against real Postgres inside a real Nest request pipeline. What is being
 * verified is that guards, cookies and the exception filter *compose*; stubbing the
 * database would exercise the assertions while leaving the wiring untested, which is
 * precisely where an authorization bug hides.
 */

/** Stand-ins for the endpoints Step 9 adds, so the guards can be tested before they exist. */
@Controller("test-fixtures")
class FixtureController {
  @Get("admin-only")
  @Roles("ADMIN")
  adminOnly(): { ok: true } {
    return { ok: true };
  }

  /** No decorator at all — the case that must fail closed. */
  @Get("any-authenticated")
  authenticated(): { ok: true } {
    return { ok: true };
  }

  @Get("open")
  @Public()
  open(): { ok: true } {
    return { ok: true };
  }
}

const ADMIN = { email: "e2e-admin@test.local", password: "e2e-admin-password-1" };
const USER = { email: "e2e-user@test.local", password: "e2e-user-password-1" };
const CREATED_PREFIX = "e2e-created-";

let app: INestApplication;
let db: Database;
let jwt: JwtService;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [FixtureController],
  })
    // The rate limiter is neutralised *for this suite only*. It logs in more than ten times
    // in under a minute, which is exactly what `/auth/login`'s throttle is there to stop —
    // so leaving it on makes these tests fail for a reason that has nothing to do with what
    // they assert. The throttle itself is verified in login-throttle.e2e.test.ts against an
    // app that keeps the real thing.
    //
    // The *storage* is replaced rather than the guard. `AppThrottlerGuard` is registered
    // under the `APP_GUARD` token with `useClass`, so the class itself is not a provider
    // token and `overrideGuard` silently matches nothing — which is how this was found,
    // with the override in place and the suite still returning 429.
    .overrideProvider(ThrottlerStorage)
    .useValue({
      // The record shape the guard reads. Written out rather than imported: the package
      // exports the `ThrottlerStorage` token from its entry point but not the record type,
      // and reaching into `dist/` for a type is worse than four fields.
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
  jwt = app.get(JwtService);

  // Seeded directly rather than through /auth/register, because registering requires an
  // admin and there is none yet — the bootstrap problem `pnpm db:seed` exists to solve.
  await seedUser(ADMIN.email, ADMIN.password, "ADMIN");
  await seedUser(USER.email, USER.password, "USER");
});

afterAll(async () => {
  await db.delete(users).where(inArray(users.email, [ADMIN.email, USER.email]));
  await db.delete(users).where(like(users.email, `${CREATED_PREFIX}%`));
  await app.close();
});

async function seedUser(email: string, password: string, role: "ADMIN" | "USER"): Promise<void> {
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

/** Logs in and returns the raw Set-Cookie strings for reuse on later requests. */
async function login(credentials: { email: string; password: string }): Promise<string[]> {
  const response = await http().post("/auth/login").send(credentials).expect(200);
  return response.headers["set-cookie"] as unknown as string[];
}

describe("authorization", () => {
  it("refuses a USER token on an admin-only route with 403", async () => {
    const cookies = await login(USER);

    const response = await http()
      .get("/test-fixtures/admin-only")
      .set("Cookie", cookies)
      .expect(403);

    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(response.body.error.requestId).toEqual(expect.any(String));
    // The message must not name the role required — free reconnaissance, no benefit.
    expect(response.body.error.message).not.toContain("ADMIN");
  });

  it("allows an ADMIN token on the same route", async () => {
    const cookies = await login(ADMIN);
    await http().get("/test-fixtures/admin-only").set("Cookie", cookies).expect(200);
  });

  it("keeps 401 and 403 distinct: a USER is authenticated, just not permitted", async () => {
    const cookies = await login(USER);
    await http().get("/test-fixtures/any-authenticated").set("Cookie", cookies).expect(200);
  });
});

describe("authentication", () => {
  it("rejects an expired access token with 401", async () => {
    // Signed with the real secret, so the expiry is the only thing that can fail.
    const expired = await jwt.signAsync(
      { email: USER.email, role: "USER" },
      {
        subject: "00000000-0000-4000-8000-000000000001",
        secret: apiEnv.JWT_ACCESS_SECRET,
        expiresIn: -10,
      },
    );

    const response = await http()
      .get("/test-fixtures/any-authenticated")
      .set("Authorization", `Bearer ${expired}`)
      .expect(401);

    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a token signed with the refresh secret", async () => {
    // The reason the two secrets must differ: otherwise a refresh token — which should
    // only work at /auth/refresh — would verify as an access token everywhere, and this
    // forged one even claims ADMIN.
    const wrongKey = await jwt.signAsync(
      { email: USER.email, role: "ADMIN" },
      {
        subject: "00000000-0000-4000-8000-000000000001",
        secret: apiEnv.JWT_REFRESH_SECRET,
      },
    );

    await http()
      .get("/test-fixtures/admin-only")
      .set("Authorization", `Bearer ${wrongKey}`)
      .expect(401);
  });

  it("rejects a tampered token with 401", async () => {
    const cookies = await login(ADMIN);
    const token = cookieValue(cookies, "cl_access");

    await http()
      .get("/test-fixtures/admin-only")
      .set("Authorization", `Bearer ${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`)
      .expect(401);
  });

  it("requires authentication by default, with no decorator present", async () => {
    await http().get("/test-fixtures/any-authenticated").expect(401);
  });

  it("leaves only explicitly public routes open", async () => {
    await http().get("/test-fixtures/open").expect(200);
    await http().get("/auth/me").expect(401);
    await http().post("/auth/register").send({}).expect(401);
  });
});

describe("login", () => {
  it("sets httpOnly cookies and returns no tokens in the body", async () => {
    const response = await http().post("/auth/login").send(USER).expect(200);
    const cookies = response.headers["set-cookie"] as unknown as string[];

    const access = cookies.find((cookie) => cookie.startsWith("cl_access=")) ?? "";
    const refresh = cookies.find((cookie) => cookie.startsWith("cl_refresh=")) ?? "";

    expect(access).toContain("HttpOnly");
    expect(access).toContain("SameSite=Lax");
    // Scoped to the one route that consumes it, so the long-lived credential is not
    // attached to every ordinary API call.
    expect(refresh).toContain("Path=/auth/refresh");

    // No JWT anywhere in the body — that is what the httpOnly flag exists to withhold.
    expect(JSON.stringify(response.body)).not.toContain("eyJ");
    expect(response.body).not.toHaveProperty("accessToken");
    expect(response.body.user.email).toBe(USER.email);
  });

  it("is case-insensitive about the email address", async () => {
    // The Step 2 parking-lot item. The unique index is on the raw column, so the
    // normalizeEmail call in AuthService.login is the only thing making this pass.
    await http()
      .post("/auth/login")
      .send({ email: USER.email.toUpperCase(), password: USER.password })
      .expect(200);
  });

  it("gives the same answer for an unknown email and a wrong password", async () => {
    const unknown = await http()
      .post("/auth/login")
      .send({ email: "nobody@test.local", password: "some-password-value" })
      .expect(401);

    const wrong = await http()
      .post("/auth/login")
      .send({ email: USER.email, password: "wrong-password-value" })
      .expect(401);

    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it("rejects a malformed body with 400 and never echoes the password", async () => {
    const response = await http()
      .post("/auth/login")
      .send({ email: "not-an-email", password: "hunter2-secret-value" })
      .expect(400);

    expect(response.body.error.code).toBe("BAD_REQUEST");
    expect(JSON.stringify(response.body)).not.toContain("hunter2");
  });
});

describe("refresh rotation", () => {
  it("issues a new refresh token and spends the old one", async () => {
    const cookies = await login(USER);

    const rotated = await http().post("/auth/refresh").set("Cookie", cookies).expect(200);
    expect(
      cookieValue(rotated.headers["set-cookie"] as unknown as string[], "cl_refresh"),
    ).not.toBe(cookieValue(cookies, "cl_refresh"));

    await http().post("/auth/refresh").set("Cookie", cookies).expect(401);
  });

  it("revokes the whole family when a spent token is presented again", async () => {
    const cookies = await login(ADMIN);

    const rotated = await http().post("/auth/refresh").set("Cookie", cookies).expect(200);
    const successor = rotated.headers["set-cookie"] as unknown as string[];

    // Replay: either the client repeated itself or the token was stolen, and there is no
    // way to tell which — so both holders are cut off.
    await http().post("/auth/refresh").set("Cookie", cookies).expect(401);

    // The legitimate successor dies too. Harsh, and deliberate.
    await http().post("/auth/refresh").set("Cookie", successor).expect(401);
  });

  it("refuses to refresh without a refresh cookie", async () => {
    await http().post("/auth/refresh").expect(401);
  });
});

describe("logout", () => {
  it("clears the cookies and invalidates the refresh token", async () => {
    const cookies = await login(USER);

    const response = await http().post("/auth/logout").set("Cookie", cookies).expect(204);
    const cleared = response.headers["set-cookie"] as unknown as string[];
    expect(cleared.some((cookie) => cookie.startsWith("cl_access=;"))).toBe(true);

    await http().post("/auth/refresh").set("Cookie", cookies).expect(401);
  });

  it("succeeds with no session, so a broken cookie can always be discarded", async () => {
    await http().post("/auth/logout").expect(204);
  });
});

describe("registration", () => {
  it("lets an admin create a user who can then log in", async () => {
    const cookies = await login(ADMIN);
    const email = `${CREATED_PREFIX}${Date.now()}@test.local`;

    await http()
      .post("/auth/register")
      .set("Cookie", cookies)
      .send({ email, password: "created-user-password-1", role: "USER" })
      .expect(201);

    await http()
      .post("/auth/login")
      .send({ email, password: "created-user-password-1" })
      .expect(200);
  });

  it("refuses a duplicate email with 409", async () => {
    const cookies = await login(ADMIN);

    const response = await http()
      .post("/auth/register")
      .set("Cookie", cookies)
      .send({ email: USER.email, password: "another-password-value", role: "USER" })
      .expect(409);

    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("refuses a USER creating an account, even an ADMIN one", async () => {
    const cookies = await login(USER);

    await http()
      .post("/auth/register")
      .set("Cookie", cookies)
      .send({
        email: `${CREATED_PREFIX}escalation@test.local`,
        password: "password-value-12345",
        role: "ADMIN",
      })
      .expect(403);
  });
});

describe("request id", () => {
  it("returns one on every response", async () => {
    const response = await http().get("/test-fixtures/open").expect(200);
    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
  });

  it("strips characters that would forge a header or a log line", async () => {
    const response = await http()
      .get("/test-fixtures/open")
      .set("x-request-id", "abc-123	injected")
      .expect(200);

    expect(response.headers["x-request-id"]).toBe("abc-123injected");
    expect(response.headers["x-request-id"]).not.toContain("	");
  });
});

/** Extracts a cookie's value from a Set-Cookie array. */
function cookieValue(cookies: string[], name: string): string {
  const cookie = cookies.find((entry) => entry.startsWith(`${name}=`)) ?? "";
  return cookie.slice(name.length + 1).split(";")[0] ?? "";
}
