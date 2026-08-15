import { describe, expect, it } from "vitest";

import { chunkDocument } from "./chunker";
import { type TokenCounter } from "./tokenizer";

/**
 * A word counter, not the real BPE tokenizer.
 *
 * The chunker's behaviour is "respect the budget I am given", and asserting it against
 * an obvious counter makes the expected chunk boundaries something a reader can work out
 * by counting words on the page. Whether cl100k_base agrees is `tokenizer.ts`'s problem.
 */
const wordCounter: TokenCounter = {
  count: (text) => text.split(/\s+/).filter((word) => word.length > 0).length,
};

const noAbsorb = { minChunkTokens: 0 };

describe("chunkDocument", () => {
  it("merges every section of a short document into one chunk", () => {
    const source = [
      "# Delivery Report: Bubble Bakery, 2025-05",
      "",
      "Client: SweetPixel Games.",
      "",
      "## QA findings and fixes",
      "",
      "Haptics fired on every match.",
      "",
      "## Sign-off",
      "",
      "Checklist attached by Viktor.",
    ].join("\n");

    const { chunks } = chunkDocument({
      relativePath: "delivery-reports/2025-05-bubble-bakery.md",
      source,
      tokenCounter: wordCounter,
    });

    expect(chunks).toHaveLength(1);
    // Merged sections put their headings back into the body, so nothing is lost even
    // though the breadcrumb can only carry the path they share.
    expect(chunks[0]?.content).toContain("## QA findings and fixes");
    expect(chunks[0]?.content).toContain("## Sign-off");
    expect(chunks[0]?.content).toContain("Haptics fired on every match.");
  });

  it("puts document metadata and the heading path in the breadcrumb", () => {
    const source = "# Delivery Report: Bubble Bakery, 2025-05\n\n## Sign-off\n\nSigned.";

    const { chunks } = chunkDocument({
      relativePath: "delivery-reports/2025-05-bubble-bakery.md",
      source,
      tokenCounter: wordCounter,
    });

    expect(chunks[0]?.breadcrumb).toBe(
      "Delivery Report: Bubble Bakery, 2025-05 " +
        "[delivery-report · 2025-05 · bubble-bakery] > Sign-off",
    );
    expect(chunks[0]?.embeddedText.startsWith(chunks[0].breadcrumb)).toBe(true);
  });

  it("splits a section that exceeds the budget and overlaps the pieces", () => {
    // Ten distinct sentences of five words each; a 12-token budget fits two per chunk.
    const sentences = Array.from({ length: 10 }, (_, index) => `Sentence number ${index} here.`);
    const source = `# Long\n\n## Body\n\n${sentences.join(" ")}`;

    const { chunks } = chunkDocument({
      relativePath: "long.md",
      source,
      tokenCounter: wordCounter,
      options: { budgetTokens: 20, overlapTokens: 5, ...noAbsorb },
    });

    expect(chunks.length).toBeGreaterThan(1);

    // Overlap means the tail of one chunk reappears at the head of the next, so no
    // sentence sits alone at a cut with its context on the other side.
    const first = chunks[0]?.content ?? "";
    const second = chunks[1]?.content ?? "";
    const lastSentenceOfFirst =
      first
        .trim()
        .split(/(?<=\.)\s+/)
        .at(-1) ?? "";
    expect(second).toContain(lastSentenceOfFirst);
  });

  it("never cuts inside a sentence", () => {
    const sentences = Array.from(
      { length: 12 },
      (_, index) => `Alpha bravo charlie delta ${index}.`,
    );
    const source = `# Long\n\n## Body\n\n${sentences.join(" ")}`;

    const { chunks } = chunkDocument({
      relativePath: "long.md",
      source,
      tokenCounter: wordCounter,
      options: { budgetTokens: 20, overlapTokens: 0, ...noAbsorb },
    });

    for (const chunk of chunks) {
      expect(chunk.content.trim().endsWith(".")).toBe(true);
    }
  });

  it("keeps a fenced code block whole", () => {
    const fence = ["```ts", "const a = 1;", "const b = 2;", "const c = 3;", "```"].join("\n");
    const filler = Array.from({ length: 30 }, () => "padding").join(" ");
    const source = `# Code\n\n## Example\n\n${filler}\n\n${fence}\n\n${filler}`;

    const { chunks } = chunkDocument({
      relativePath: "code.md",
      source,
      tokenCounter: wordCounter,
      options: { budgetTokens: 40, overlapTokens: 0, ...noAbsorb },
    });

    // A fence has no blank line inside it, so it is a single paragraph and the splitter
    // never has a boundary to cut it on: one chunk holds both markers and the body.
    const withFence = chunks.filter((chunk) => chunk.content.includes("```ts"));
    expect(withFence).toHaveLength(1);
    expect(withFence[0]?.content).toContain("const c = 3;");
    expect(withFence[0]?.content.match(/^```/gm)).toHaveLength(2);
  });

  it("absorbs an under-minimum fragment into its neighbour", () => {
    const source = [
      "# Changelog",
      "",
      "## Release",
      "",
      Array.from({ length: 30 }, () => "word").join(" "),
      "",
      "## Note",
      "",
      "Tiny.",
    ].join("\n");

    const { chunks } = chunkDocument({
      relativePath: "changelogs/lumen-build-4.2.md",
      source,
      tokenCounter: wordCounter,
      // A budget that forces the two sections apart, and a minimum that pulls the second
      // one back in rather than embedding a one-word chunk on its own.
      options: { budgetTokens: 35, overlapTokens: 0, minChunkTokens: 10 },
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain("Tiny.");
    expect(chunks[0]?.content).toContain("## Note");
  });

  it("keeps a document that is entirely below the minimum as a single chunk", () => {
    const { chunks } = chunkDocument({
      relativePath: "changelogs/lumen-build-4.2.md",
      source: "# lumen-build 4.2\n\nOne short line.",
      tokenCounter: wordCounter,
      options: { minChunkTokens: 80 },
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe("One short line.");
  });

  it("returns no chunks for an empty document and falls back to the filename for a title", () => {
    const empty = chunkDocument({
      relativePath: "empty.md",
      source: "",
      tokenCounter: wordCounter,
    });
    expect(empty.chunks).toEqual([]);

    const untitled = chunkDocument({
      relativePath: "guides/asset-naming.md",
      source: "No heading at all here.",
      tokenCounter: wordCounter,
    });
    expect(untitled.title).toBe("asset-naming");
    expect(untitled.chunks[0]?.breadcrumb).toBe("asset-naming [guide · asset-naming]");
  });

  it("numbers chunks from zero in document order", () => {
    const sentences = Array.from({ length: 20 }, (_, index) => `Word ${index} filler text here.`);
    const { chunks } = chunkDocument({
      relativePath: "long.md",
      source: `# Long\n\n## Body\n\n${sentences.join(" ")}`,
      tokenCounter: wordCounter,
      options: { budgetTokens: 20, overlapTokens: 0, ...noAbsorb },
    });

    expect(chunks.map((chunk) => chunk.ordinal)).toEqual(
      Array.from({ length: chunks.length }, (_, index) => index),
    );
  });
});
