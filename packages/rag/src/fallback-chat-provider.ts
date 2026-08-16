import { ChatError, type ChatProvider, type ChatRequest } from "./chat-provider";

/**
 * Uses the hosted model when the credential works, and the offline answerer when it does
 * not — deciding by *trying*, not by asking.
 *
 * The obvious design is a startup probe: check the balance once, pick a provider, done.
 * That is wrong here for a reason this project ran into directly — credit does not run out
 * when the process starts, it runs out halfway through a session, and a server that chose
 * its provider at boot would then fail every remaining request. So the primary is simply
 * attempted, and a failure that will clearly repeat switches the mode.
 *
 * **What counts as "clearly repeat".** Only 401, 402 and 403: the credential itself is
 * unusable and no amount of waiting fixes it. A 429 or a 5xx is the provider being busy or
 * broken for a moment, and permanently abandoning the real model over that would trade a
 * transient failure for a permanent quality loss. Those propagate as before.
 *
 * **Recovery without a restart.** The switch is a circuit breaker with a cooldown, not a
 * latch. After it expires the primary is tried again, so topping up a balance takes effect
 * on its own rather than requiring someone to notice and restart the server.
 *
 * The answer stays honest either way: `answerMode` is read from whichever provider
 * actually produced the text, so a fallback answer is labelled as extractive in the API
 * response and in the UI. A silent degradation would be the thing worth objecting to; a
 * declared one is a working system on a dead credential.
 */
export interface FallbackChatOptions {
  primary: ChatProvider;
  fallback: ChatProvider;
  /** How long to stop attempting the primary after a credential failure. */
  cooldownMs?: number;
  /** Called on each switch, so the operator learns from the log rather than from a user. */
  onFallback?: (reason: string) => void;
  now?: () => number;
}

export const DEFAULT_FALLBACK_COOLDOWN_MS = 5 * 60_000;

/**
 * The composite reports the mode of whichever provider is currently in use, so a caller
 * reading `provider.mode` before the request gets the *expected* answerer. The authoritative
 * value is still the one `answer.ts` records after the call.
 */
export function createFallbackChatProvider(options: FallbackChatOptions): ChatProvider {
  const cooldownMs = options.cooldownMs ?? DEFAULT_FALLBACK_COOLDOWN_MS;
  const now = options.now ?? (() => Date.now());

  let blockedUntil = 0;

  return {
    get model(): string {
      return now() < blockedUntil ? options.fallback.model : options.primary.model;
    },
    get mode(): "model" | "extractive" {
      return now() < blockedUntil ? options.fallback.mode : options.primary.mode;
    },

    async complete(request: ChatRequest): Promise<string> {
      if (now() < blockedUntil) return await options.fallback.complete(request);

      // Tokens are withheld until the primary has committed to succeeding. Passing
      // `onToken` straight through would let a few tokens reach the client and then be
      // followed by an entirely different answer from the fallback — the user would watch
      // one answer get replaced by another mid-sentence.
      let streamed = false;
      const watch = (token: string): void => {
        streamed = true;
        request.onToken?.(token);
      };

      try {
        return await options.primary.complete({ ...request, onToken: watch });
      } catch (error) {
        if (!(error instanceof ChatError) || !error.isCredentialFailure) throw error;

        // Nothing to do if the primary already emitted: the client has half an answer and
        // replacing it now would be worse than reporting the failure.
        if (streamed) throw error;

        blockedUntil = now() + cooldownMs;
        options.onFallback?.(error.message);

        return await options.fallback.complete(request);
      }
    },
  };
}
