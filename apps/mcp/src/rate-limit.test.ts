import { describe, expect, it } from "vitest";

import { createRateLimiter } from "./rate-limit";

/**
 * The properties that matter are the boring ones: the limit is per key, the window really
 * expires, and a refused caller is told when to come back. A limiter that silently shares
 * one budget across every caller would look identical in a smoke test and would take the
 * whole server down on one noisy client.
 */
describe("createRateLimiter", () => {
  it("allows requests up to the limit and refuses the next one", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => 0 });

    expect(limiter.check("user-1").allowed).toBe(true);
    expect(limiter.check("user-1").allowed).toBe(true);
    expect(limiter.check("user-1").allowed).toBe(true);
    expect(limiter.check("user-1").allowed).toBe(false);
  });

  it("keeps a separate budget per caller", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });

    expect(limiter.check("user-1").allowed).toBe(true);
    expect(limiter.check("user-1").allowed).toBe(false);
    // One caller exhausting their budget must not affect anyone else.
    expect(limiter.check("user-2").allowed).toBe(true);
  });

  it("starts a fresh window once the old one expires", () => {
    let clock = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => clock });

    expect(limiter.check("user-1").allowed).toBe(true);
    expect(limiter.check("user-1").allowed).toBe(false);

    clock = 1000;
    expect(limiter.check("user-1").allowed).toBe(true);
  });

  it("reports whole seconds until the window resets, never zero", () => {
    let clock = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => clock });

    limiter.check("user-1");
    expect(limiter.check("user-1").retryAfterSeconds).toBe(60);

    // 100ms left rounds up to 1: telling a client to retry in 0 seconds invites a retry
    // that is certain to fail.
    clock = 59_900;
    expect(limiter.check("user-1").retryAfterSeconds).toBe(1);
  });
});
