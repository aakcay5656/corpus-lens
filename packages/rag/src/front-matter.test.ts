import { describe, expect, it } from "vitest";

import { parseFrontMatter } from "./front-matter";

describe("parseFrontMatter", () => {
  it("reads flat key: value pairs and returns the remaining body", () => {
    const parsed = parseFrontMatter(
      '---\nauthor: Marco\ntitle: "Quoted Title"\n---\n# Doc\n\nBody.',
    );

    expect(parsed.data).toEqual({ author: "Marco", title: "Quoted Title" });
    expect(parsed.body).toBe("# Doc\n\nBody.");
    expect(parsed.unsupportedLines).toEqual([]);
  });

  it("leaves a document without front-matter completely untouched", () => {
    const source = "# Doc\n\nBody with --- inside it.";

    expect(parseFrontMatter(source)).toEqual({
      data: {},
      body: source,
      unsupportedLines: [],
    });
  });

  it("does not swallow the document when the block is never closed", () => {
    // A leading '---' with no partner is a horizontal rule or a broken file. Treating it
    // as front-matter would consume the entire document as metadata.
    const source = "---\nauthor: Marco\n# Doc\n\nBody.";

    expect(parseFrontMatter(source).body).toBe(source);
    expect(parseFrontMatter(source).data).toEqual({});
  });

  it("reports nested lines instead of silently dropping them", () => {
    const parsed = parseFrontMatter("---\nauthor: Marco\ntags:\n  - one\n  - two\n---\nBody.");

    expect(parsed.data).toEqual({ author: "Marco", tags: "" });
    // The nested entries could not be read. Surfacing them is what tells an operator this
    // corpus needs a real YAML parser, rather than the metadata just being absent.
    expect(parsed.unsupportedLines).toEqual(["  - one", "  - two"]);
  });

  it("handles an empty front-matter block", () => {
    const parsed = parseFrontMatter("---\n---\nBody.");

    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe("Body.");
  });
});
