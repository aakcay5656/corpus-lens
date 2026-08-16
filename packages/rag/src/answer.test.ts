import { describe, expect, it } from "vitest";

import { ABSTENTION_TEXT, answerQuestion, minimumFusedScore } from "./answer";
import { NO_ANSWER_SENTINEL } from "./answer-prompt";
import { type ChatMessage, type ChatProvider } from "./chat-provider";
import { createDeterministicEmbeddingProvider } from "./deterministic-embedding-provider";
import { type RetrievalRepository, type RetrievedChunk } from "./retriever";
import { type TokenCounter } from "./tokenizer";

const wordCounter: TokenCounter = {
  count: (text) => text.split(/\s+/).filter((word) => word.length > 0).length,
};
const embeddingProvider = createDeterministicEmbeddingProvider({ dimensions: 32 });

const DISTINCT_CONTENT = [
  "AppLovin playables ship as a single self-contained HTML file, maximum five megabytes.",
  "Korean line breaks split mid-word on the end card; locale-aware wrapping was enabled.",
  "Audio is built in a dedicated pass because the unified compression path regressed sizes.",
  "Delivery review is run by a developer outside the pod, never the author of the build.",
  "Every playable ships with seven languages and falls back to English when one is missing.",
  "The verify stage measures the final inlined artifact rather than the pre-inline bundle.",
];

function chunk(index: number, content?: string): RetrievedChunk {
  return {
    chunkId: `00000000-0000-4000-8000-00000000000${index}`,
    documentId: `10000000-0000-4000-8000-00000000000${index}`,
    documentTitle: `Document ${index}`,
    sourcePath: `doc-${index}.md`,
    docType: "reference",
    breadcrumb: `Document ${index} [reference]`,
    // Genuinely distinct wording per chunk. The near-duplicate suppression in the prompt
    // builder is real, so fixtures that differ only by a digit get collapsed — which is
    // correct behaviour and would otherwise look like a bug in these tests.
    content: content ?? DISTINCT_CONTENT[index % DISTINCT_CONTENT.length],
    ordinal: 0,
    rawScore: 0.8,
  };
}

/** Both arms return the same chunks, so every fused score clears the floor. */
function agreeingRepository(chunks: RetrievedChunk[]): RetrievalRepository {
  return {
    searchByVector: () => Promise.resolve(chunks),
    searchByKeyword: () => Promise.resolve(chunks),
  };
}

/** Only the vector arm returns anything, so the best score is exactly 1/(k+1). */
function singleArmRepository(chunks: RetrievedChunk[]): RetrievalRepository {
  return {
    searchByVector: () => Promise.resolve(chunks),
    searchByKeyword: () => Promise.resolve([]),
  };
}

function stubProvider(reply: string): ChatProvider & { calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  return {
    calls,
    model: "stub",
    complete: (request) => {
      calls.push(request.messages);
      request.onToken?.(reply);
      return Promise.resolve(reply);
    },
  };
}

function ask(
  repository: RetrievalRepository,
  provider: ChatProvider,
  question = "What is the AppLovin size limit?",
) {
  return answerQuestion({
    repository,
    embeddingProvider,
    tokenCounter: wordCounter,
    chatProvider: provider,
    question,
    topK: 3,
  });
}

describe("answerQuestion", () => {
  it("returns a grounded answer with resolved citations", async () => {
    const provider = stubProvider("The limit is 5 MB [1], shipped as one file [2].");

    const result = await ask(agreeingRepository([chunk(1), chunk(2)]), provider);

    expect(result.answered).toBe(true);
    expect(result.abstainReason).toBeNull();
    expect(result.citations.map((citation) => citation.sourcePath)).toEqual([
      "doc-1.md",
      "doc-2.md",
    ]);
    expect(result.sources).toHaveLength(2);
    expect(result.timings.generateMs).not.toBeNull();
  });

  /** Layer 1: the score floor, which decides before the model is called. */
  it("abstains without calling the model when nothing was retrieved", async () => {
    const provider = stubProvider("should never be produced");

    const result = await ask(agreeingRepository([]), provider);

    expect(result.answered).toBe(false);
    expect(result.abstainReason).toBe("NO_RELEVANT_CONTEXT");
    expect(result.text).toBe(ABSTENTION_TEXT);
    expect(provider.calls).toEqual([]);
    // Null rather than 0: the generation stage did not happen, which is different from
    // having happened instantly.
    expect(result.timings.generateMs).toBeNull();
  });

  it("abstains on the floor when only one retrieval arm found anything", async () => {
    const provider = stubProvider("should never be produced");

    const result = await ask(singleArmRepository([chunk(1)]), provider);

    // 1/(60+1) = 0.0164, below the 0.0289 floor: neither arm agreed with the other.
    expect(result.answered).toBe(false);
    expect(result.abstainReason).toBe("NO_RELEVANT_CONTEXT");
    expect(provider.calls).toEqual([]);
  });

  /** Layer 2: the prompt rule, for a question whose topic is covered but answer is not. */
  it("abstains when the model returns the sentinel despite good retrieval", async () => {
    const provider = stubProvider(NO_ANSWER_SENTINEL);

    const result = await ask(agreeingRepository([chunk(1), chunk(2)]), provider);

    expect(result.answered).toBe(false);
    expect(result.abstainReason).toBe("MODEL_DECLINED");
    expect(result.text).toBe(ABSTENTION_TEXT);
    // Retrieval still happened, so the sources are still reported — the UI can show what
    // was considered and rejected.
    expect(result.sources).toHaveLength(2);
    expect(result.citations).toEqual([]);
  });

  it("recognises a sentinel the model wrapped in punctuation or a fence", async () => {
    for (const reply of ["**NO_ANSWER**", "```\nNO_ANSWER\n```", "  NO_ANSWER.  "]) {
      const result = await ask(agreeingRepository([chunk(1)]), stubProvider(reply));
      expect(result.answered).toBe(false);
      expect(result.abstainReason).toBe("MODEL_DECLINED");
    }
  });

  it("does not treat the sentinel inside a real answer as a refusal", async () => {
    // A model explaining the instruction is not obeying it; discarding this would throw
    // away a genuine answer.
    const provider = stubProvider("The rule says to reply NO_ANSWER when unsupported [1].");

    const result = await ask(agreeingRepository([chunk(1)]), provider);

    expect(result.answered).toBe(true);
  });

  it("drops a hallucinated citation and reports it", async () => {
    const provider = stubProvider("Grounded [1] and invented [9].");

    const result = await ask(agreeingRepository([chunk(1), chunk(2)]), provider);

    expect(result.answered).toBe(true);
    expect(result.citations.map((citation) => citation.marker)).toEqual([1]);
    expect(result.droppedMarkers).toEqual([9]);
    expect(result.text).not.toContain("[9]");
  });

  it("never attaches a citation to an abstention", async () => {
    const provider = stubProvider(NO_ANSWER_SENTINEL);

    const result = await ask(agreeingRepository([chunk(1)]), provider);

    expect(result.citations).toEqual([]);
  });

  it("puts the numbered sources and both rules in front of the model", async () => {
    const provider = stubProvider("Answer [1].");

    await ask(agreeingRepository([chunk(1), chunk(2)]), provider);

    const [messages] = provider.calls;
    const system = messages?.[0]?.content ?? "";
    const user = messages?.[1]?.content ?? "";

    expect(system).toContain(NO_ANSWER_SENTINEL);
    // The conflict/deprecation rule from docs/CORPUS.md §3.3.
    expect(system.toLowerCase()).toContain("deprecated");
    expect(user).toContain("[1] Document 1 [reference]");
    expect(user).toContain("[2] Document 2 [reference]");
    expect(user).toContain("What is the AppLovin size limit?");
  });

  it("forwards streamed tokens to the caller", async () => {
    const tokens: string[] = [];

    await answerQuestion({
      repository: agreeingRepository([chunk(1)]),
      embeddingProvider,
      tokenCounter: wordCounter,
      chatProvider: stubProvider("Answer [1]."),
      question: "What is the AppLovin size limit?",
      topK: 3,
      onToken: (token) => tokens.push(token),
    });

    expect(tokens.join("")).toBe("Answer [1].");
  });
});

describe("near-duplicate suppression", () => {
  /**
   * The bug this pins was live for about a minute while being written: deduplicating the
   * passages for the *prompt* while validating markers against the *original* list makes
   * every citation after a dropped passage resolve to the wrong document — silently, and
   * invisibly in a browser. One list, used for the prompt, the validation and the sources.
   */
  it("keeps markers, sources and citations aligned after dropping a duplicate", async () => {
    const original = "Orientation switch during the fail popup misplaced the retry button.";
    const chunks = [
      chunk(1, original),
      chunk(2, `${original} `), // a repeat of source 1
      chunk(3, "Korean line breaks split mid-word on the end card; locale-aware wrapping."),
    ];

    // The model cites source 2 — which, after deduplication, is the *third* chunk.
    const provider = stubProvider("Line breaking was fixed [2].");
    const result = await ask(agreeingRepository(chunks), provider);

    expect(result.sources).toHaveLength(2);
    expect(result.sources.map((source) => source.sourcePath)).toEqual(["doc-1.md", "doc-3.md"]);

    const [citation] = result.citations;
    expect(citation?.marker).toBe(2);
    expect(citation?.sourcePath).toBe("doc-3.md");
    // The reported sources are what the marker indexes into.
    expect(result.sources[citation?.sourceIndex ?? -1]?.sourcePath).toBe(citation?.sourcePath);
  });

  it("shows the model only one copy of a repeated passage", async () => {
    const repeated = "Cta contrast fell below 4.5:1 on the client's light background.";
    const provider = stubProvider("Answer [1].");

    await ask(
      agreeingRepository([chunk(1, repeated), chunk(2, repeated), chunk(3, repeated)]),
      provider,
    );

    const user = provider.calls[0]?.[1]?.content ?? "";
    // Three identical passages retrieved, one sent — the corpus's 78 near-identical
    // delivery reports are exactly this case, and repeating a claim teaches nothing.
    expect(user.match(/^\[\d+\]/gm)).toHaveLength(1);
  });

  it("keeps passages that merely share a topic", async () => {
    const provider = stubProvider("Answer [1][2].");

    const result = await ask(
      agreeingRepository([
        chunk(1, "Haptics fired on every match on ios which the client found excessive."),
        chunk(2, "Memory grew slightly after repeated loops due to retained particle pools."),
      ]),
      provider,
    );

    // Both are QA findings in the same template; neither repeats the other.
    expect(result.sources).toHaveLength(2);
  });
});

describe("minimumFusedScore", () => {
  it("is the score of a chunk both arms found, one first and one last", () => {
    // Derived, not tuned: 1/(60+1) + 1/(60+20).
    expect(minimumFusedScore()).toBeCloseTo(1 / 61 + 1 / 80, 12);
  });

  it("sits above a single arm's best possible score", () => {
    // The whole assertion of the floor: one arm alone is never enough.
    expect(minimumFusedScore()).toBeGreaterThan(1 / 61);
  });
});
