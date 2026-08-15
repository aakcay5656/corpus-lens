import { type Metadata } from "next";

import { ChatPanel } from "./chat-panel";

export const metadata: Metadata = { title: "Chat · corpus-lens" };

/**
 * A Server Component wrapping one client island.
 *
 * The page itself needs no data — the session is already resolved by the layout and the
 * middleware — so everything above `ChatPanel` stays server-rendered and only the part
 * that genuinely needs interaction and a streaming connection ships JavaScript.
 */
export default function ChatPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Ask the corpus</h1>
        <p className="mt-1 text-sm text-muted">
          Answers are built only from the indexed documents and cite the passages they came from.
          When the corpus does not cover a question, the answer says so instead of guessing.
        </p>
      </div>

      <ChatPanel />
    </div>
  );
}
