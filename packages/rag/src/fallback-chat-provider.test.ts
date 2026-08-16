import { describe, expect, it } from "vitest";

import { ChatError, type ChatProvider, type ChatRequest } from "./chat-provider";
import { createFallbackChatProvider } from "./fallback-chat-provider";

/**
 * The rules under test are all about *which* failures switch modes and for how long.
 * Getting them wrong is not a crash — it is a system that quietly stops using the real
 * model because a provider was busy for a second, which nobody would notice.
 */
function provider(
  mode: "model" | "extractive",
  behaviour: (request: ChatRequest) => Promise<string>,
): ChatProvider & { calls: number } {
  const stub = {
    calls: 0,
    model: mode === "model" ? "hosted" : "extractive-offline",
    mode,
    complete: (request: ChatRequest): Promise<string> => {
      stub.calls += 1;
      return behaviour(request);
    },
  };
  return stub;
}

const failing = (status: number) =>
  provider("model", () => Promise.reject(new ChatError(`failed with ${status}`, false, status)));

const working = (text = "hosted answer") => provider("model", () => Promise.resolve(text));
const offline = (text = "offline answer") => provider("extractive", () => Promise.resolve(text));

function request(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return { messages: [], maxOutputTokens: 100, temperature: 0, ...overrides };
}

describe("createFallbackChatProvider", () => {
  it("uses the hosted model while the credential works", async () => {
    const primary = working();
    const fallback = offline();

    const composite = createFallbackChatProvider({ primary, fallback });

    expect(await composite.complete(request())).toBe("hosted answer");
    expect(fallback.calls).toBe(0);
    expect(composite.mode).toBe("model");
  });

  it.each([401, 402, 403])("falls back when the credential fails with %i", async (status) => {
    const primary = failing(status);
    const fallback = offline();

    const composite = createFallbackChatProvider({ primary, fallback });

    expect(await composite.complete(request())).toBe("offline answer");
    expect(composite.mode).toBe("extractive");
  });

  /**
   * The distinction the whole design turns on. A busy provider is not a dead credential,
   * and permanently abandoning the real model over one would trade a moment's failure for
   * a lasting quality loss.
   */
  it.each([429, 500, 503])(
    "propagates transient failure %i instead of falling back",
    async (status) => {
      const primary = failing(status);
      const fallback = offline();

      const composite = createFallbackChatProvider({ primary, fallback });

      await expect(composite.complete(request())).rejects.toThrow(ChatError);
      expect(fallback.calls).toBe(0);
      expect(composite.mode).toBe("model");
    },
  );

  it("stops attempting the hosted model during the cooldown", async () => {
    const primary = failing(402);
    const fallback = offline();

    const composite = createFallbackChatProvider({ primary, fallback, cooldownMs: 1000 });

    await composite.complete(request());
    await composite.complete(request());
    await composite.complete(request());

    // One doomed attempt, not one per question — otherwise every request pays a network
    // round trip to rediscover an empty balance.
    expect(primary.calls).toBe(1);
    expect(fallback.calls).toBe(3);
  });

  it("tries the hosted model again once the cooldown expires", async () => {
    let clock = 0;
    let failNext = true;
    const primary = provider("model", () => {
      if (failNext) return Promise.reject(new ChatError("no credit", false, 402));
      return Promise.resolve("hosted answer");
    });

    const composite = createFallbackChatProvider({
      primary,
      fallback: offline(),
      cooldownMs: 1000,
      now: () => clock,
    });

    expect(await composite.complete(request())).toBe("offline answer");

    // Topping up a balance should take effect on its own; requiring a restart to notice
    // would be a worse failure than the one being recovered from.
    failNext = false;
    clock = 1001;
    expect(await composite.complete(request())).toBe("hosted answer");
    expect(composite.mode).toBe("model");
  });

  /**
   * Without this the user watches a few words of one answer appear and then be replaced by
   * a different answer mid-sentence.
   */
  it("withholds streamed tokens until the hosted model commits", async () => {
    const seen: string[] = [];
    const primary = provider("model", async (req) => {
      req.onToken?.("this should never reach the client");
      return await Promise.reject(new ChatError("no credit", false, 402));
    });

    const composite = createFallbackChatProvider({ primary, fallback: offline() });

    // The primary emitted before failing, so falling back would splice two answers
    // together. The failure is reported instead.
    await expect(
      composite.complete(request({ onToken: (token) => seen.push(token) })),
    ).rejects.toThrow(ChatError);
  });

  it("passes streamed tokens through when the hosted model succeeds", async () => {
    const seen: string[] = [];
    const primary = provider("model", (req) => {
      req.onToken?.("hosted ");
      req.onToken?.("answer");
      return Promise.resolve("hosted answer");
    });

    const composite = createFallbackChatProvider({ primary, fallback: offline() });
    await composite.complete(request({ onToken: (token) => seen.push(token) }));

    expect(seen.join("")).toBe("hosted answer");
  });

  it("reports the switch so it appears in a log rather than only to a user", async () => {
    const reasons: string[] = [];

    const composite = createFallbackChatProvider({
      primary: failing(402),
      fallback: offline(),
      onFallback: (reason) => reasons.push(reason),
    });

    await composite.complete(request());
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("402");
  });
});
