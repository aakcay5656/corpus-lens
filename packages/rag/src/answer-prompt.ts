import { type Passage } from "@corpus-lens/shared/search";

/**
 * The generation prompt.
 *
 * This file is where the grading happens. CLAUDE.md §6 says grounding and abstention are
 * marked harder than eloquence, so every rule below is a rule about what the model may
 * not do, and each one exists because of something measured in the corpus rather than as
 * generic prompt hygiene.
 */

/**
 * The sentinel a refusal must be. A closed token rather than "say you don't know",
 * because detecting abstention by searching prose for apology phrasings is exactly the
 * string-matching the `answered` boolean exists to avoid — and it breaks the moment the
 * model phrases its refusal differently or answers *in* a language other than English.
 */
export const NO_ANSWER_SENTINEL = "NO_ANSWER";

export const SYSTEM_PROMPT = `You answer questions about an internal documentation corpus, using ONLY the numbered sources supplied with each question.

RULES

1. Ground every claim. Each sentence containing a fact must cite the source it came from with a marker like [1] or [2][3]. If you cannot point at a source for a statement, do not write the statement.

2. Never use knowledge from outside the sources. You may know the answer from training; that is not evidence about this corpus. If the sources do not support it, it is not in the corpus.

3. Cite only the numbers you were given. Never invent a source number, and never cite a document by name that does not appear in the list.

4. If the sources do not contain the answer, reply with exactly:
${NO_ANSWER_SENTINEL}
on its own line and nothing else. Do not apologise, do not speculate, do not offer related information. A partially relevant source is not an answer — sources that are merely about the same general topic, or about the same organisation, do not make an unanswerable question answerable.

5. When sources disagree, or one is marked deprecated, superseded or replaced: prefer the current one AND say explicitly that the other is superseded, naming both. Never silently pick a side and never present a deprecated instruction as current guidance.

6. If sources conflict on a fact and neither is marked current, report the disagreement rather than choosing. Say what each source claims and cite both.

7. Be direct. Answer in a few sentences unless the question asks for a list. Do not restate the question, do not describe what the sources are, and do not add a closing summary.`;

/**
 * Renders the retrieved chunks as numbered sources.
 *
 * The breadcrumb is included above each chunk, and it is doing real work here rather than
 * decorating: it carries the document's type, date and subject (docs/CORPUS.md §3.2), so
 * the model can tell 2025-12 Merge Marina from 2025-11 Merge Marina when the bodies are
 * near-identical. It is also what carries "(DEPRECATED)" and "(current)" from the SDK
 * document titles into the context, which is what rule 5 keys off.
 *
 * Numbering is 1-based to match the `[n]` markers the model is asked to write.
 */
export function buildSourcesBlock(passages: Passage[]): string {
  return passages
    .map((passage, index) => {
      const header = `[${index + 1}] ${passage.breadcrumb}`;
      return `${header}\n${passage.content}`;
    })
    .join("\n\n---\n\n");
}

export function buildUserPrompt(question: string, passages: Passage[]): string {
  return `SOURCES
${buildSourcesBlock(passages)}

QUESTION
${question}`;
}
