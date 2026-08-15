import { type ChatProvider } from "./chat-provider";
import {
  DEFAULT_CHAT_BASE_URL,
  DEFAULT_CHAT_MODEL,
  createOpenAiChatProvider,
} from "./openai-chat-provider";

/**
 * The one place the chat provider is chosen, mirroring the embedding factory.
 *
 * There is deliberately no offline counterpart here, unlike embeddings. A hashing trick
 * can stand in for an embedding model because both produce a vector whose only job is to
 * be compared; nothing can stand in for generation. A canned-text "offline mode" would
 * make the abstain rule and the citation validator look like they work when they had
 * never been exercised, which is worse than requiring a key for this one feature.
 */
export const CHAT_PROVIDER_KINDS = ["openai"] as const;
export type ChatProviderKind = (typeof CHAT_PROVIDER_KINDS)[number];

export interface ChatProviderConfig {
  kind: ChatProviderKind;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export { DEFAULT_CHAT_BASE_URL, DEFAULT_CHAT_MODEL };

export function createChatProvider(config: ChatProviderConfig): ChatProvider {
  const apiKey = config.apiKey;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error(
      "Answering requires CHAT_API_KEY (or OPENAI_API_KEY). Search and the dashboard " +
        "work without it; only grounded answers need a generation model.",
    );
  }

  return createOpenAiChatProvider({
    apiKey,
    model: config.model ?? DEFAULT_CHAT_MODEL,
    baseUrl: config.baseUrl ?? DEFAULT_CHAT_BASE_URL,
    timeoutMs: config.timeoutMs,
  });
}
