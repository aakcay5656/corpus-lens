import { describe, expect, it } from "vitest";

import { parseMarkdown } from "./markdown-sections";

describe("parseMarkdown", () => {
  it("takes the first level-1 heading as the title and keeps it out of the path", () => {
    const parsed = parseMarkdown("# Lumen SDK v3\n\nIntro paragraph.\n\n## Events\n\nBody.");

    expect(parsed.title).toBe("Lumen SDK v3");
    expect(parsed.sections).toEqual([
      { headingPath: [], content: "Intro paragraph." },
      { headingPath: ["Events"], content: "Body." },
    ]);
  });

  it("records the full ancestor path for nested headings", () => {
    const parsed = parseMarkdown(
      "# Title\n\n## Section\n\nA\n\n### Subsection\n\nB\n\n## Other\n\nC",
    );

    expect(parsed.sections.map((section) => section.headingPath)).toEqual([
      ["Section"],
      ["Section", "Subsection"],
      ["Other"],
    ]);
  });

  it("does not treat a '#' inside a fenced code block as a heading", () => {
    const parsed = parseMarkdown(
      "# Title\n\n## Setup\n\n```bash\n# install first\nnpm i\n```\n\nAfter the fence.",
    );

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]?.headingPath).toEqual(["Setup"]);
    expect(parsed.sections[0]?.content).toContain("# install first");
  });

  it("closes a fence only with its own marker character", () => {
    const parsed = parseMarkdown("# Title\n\n~~~\n```\n## not a heading\n~~~\n\n## Real\n\nBody.");

    expect(parsed.sections.map((section) => section.headingPath)).toEqual([[], ["Real"]]);
    expect(parsed.sections[0]?.content).toContain("## not a heading");
  });

  it("drops a heading with no body, which has nothing to retrieve", () => {
    const parsed = parseMarkdown("# Title\n\n## Empty\n\n## Full\n\nBody.");

    expect(parsed.sections).toEqual([{ headingPath: ["Full"], content: "Body." }]);
  });

  /**
   * The hazard recorded in docs/CORPUS.md §5: all six changelogs indent their first
   * bullet by four spaces, which CommonMark reads as an indented code block. This test
   * is the reason the parser is a line scanner rather than an AST walk.
   */
  it("keeps a four-space-indented bullet as ordinary content", () => {
    const source = [
      "# lumen-build 4.2 (2026-03-30)",
      "",
      "    - Reverted the unified compression path: audio returns to its dedicated pass.",
      "- Verify stage now measures the final inlined artifact.",
    ].join("\n");

    const parsed = parseMarkdown(source);

    expect(parsed.title).toBe("lumen-build 4.2 (2026-03-30)");
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]?.content).toContain("Reverted the unified compression path");
    expect(parsed.sections[0]?.content).toContain("Verify stage now measures");
  });

  it("survives an empty document and a document with no headings", () => {
    expect(parseMarkdown("")).toEqual({ title: null, sections: [] });
    expect(parseMarkdown("Just one line.")).toEqual({
      title: null,
      sections: [{ headingPath: [], content: "Just one line." }],
    });
  });
});
