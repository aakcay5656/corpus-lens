import { type ChatProvider } from "./chat-provider";
import { createExtractiveChatProvider } from "./extractive-chat-provider";
import { createFallbackChatProvider } from "./fallback-chat-provider";
import {
  DEFAULT_CHAT_BASE_URL,
  DEFAULT_CHAT_MODEL,
  createOpenAiChatProvider,
} from "./openai-chat-provider";

/**
 * The one place the chat provider is chosen, mirroring the embedding factory.
 *
 * `auto` attempts the hosted model and falls back to the offline answerer when the
 * *credential* fails — a 401, 402 or 403, which will repeat until a human intervenes —
 * while letting transient failures propagate as before. It is the useful default: with a
 * working key it is `openai`, without one it is `extractive`, and it survives a balance
 * running out mid-session without a restart. See `fallback-chat-provider.ts`.
 *
 * `extractive` is an offline mode added after Step 7 argued against having one. The
 * original objection — that canned text would make the abstain rule and the citation
 * validator *look* exercised without running them — is answered by construction rather
 * than dropped: the extractive provider is a `ChatProvider` like any other, so its output
 * goes through the same validation, sentinel detection and abstention path. It selects
 * sentences rather than composing them, so it cannot hallucinate, and it cannot synthesise
 * either. See `extractive-chat-provider.ts`.
 */
export const CHAT_PROVIDER_KINDS = ["auto", "openai", "extractive"] as const;
export type ChatProviderKind = (typeof CHAT_PROVIDER_KINDS)[number];

export interface ChatProviderConfig {
  kind: ChatProviderKind;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Called when `auto` switches to the offline answerer, so it appears in the log. */
  onFallback?: (reason: string) => void;
}

export { DEFAULT_CHAT_BASE_URL, DEFAULT_CHAT_MODEL };

export function createChatProvider(config: ChatProviderConfig): ChatProvider {
  if (config.kind === "extractive") return createExtractiveChatProvider();

  const apiKey = config.apiKey;
  const hasKey = apiKey !== undefined && apiKey.length > 0;

  if (config.kind === "auto") {
    // No key at all: there is no primary to attempt, so this is simply offline mode. The
    // alternative — constructing a provider that fails every request in order to fall back
    // from it — would spend a network round trip per question to learn what is already
    // known.
    if (!hasKey) return createExtractiveChatProvider();

    return createFallbackChatProvider({
      primary: createOpenAiChatProvider({
        apiKey,
        model: config.model ?? DEFAULT_CHAT_MODEL,
        baseUrl: config.baseUrl ?? DEFAULT_CHAT_BASE_URL,
        timeoutMs: config.timeoutMs,
      }),
      fallback: createExtractiveChatProvider(),
      onFallback: config.onFallback,
    });
  }

  if (!hasKey) {
    throw new Error(
      "CHAT_PROVIDER=openai requires CHAT_API_KEY (or OPENAI_API_KEY). Use " +
        "CHAT_PROVIDER=auto to fall back to the offline answerer instead, or " +
        "CHAT_PROVIDER=extractive to run offline always.",
    );
  }

  return createOpenAiChatProvider({
    apiKey,
    model: config.model ?? DEFAULT_CHAT_MODEL,
    baseUrl: config.baseUrl ?? DEFAULT_CHAT_BASE_URL,
    timeoutMs: config.timeoutMs,
  });
}
