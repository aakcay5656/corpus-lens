import { splitQueryTerms } from "@corpus-lens/shared/query-terms";

/**
 * Rewrites the query that goes to the **vector arm only**, by dropping terms that appear in
 * a majority of the corpus.
 *
 * **The asymmetry is the whole idea.** `ts_rank` already discounts a common term: a lexeme
 * present in most documents contributes almost nothing to a keyword score, because that is
 * what inverse document frequency does. Embeddings have no such mechanism. Every word in
 * the query text moves the vector, and a phrase naming a large document class moves it
 * straight into the middle of that class — where all 78 members sit almost on top of each
 * other (docs/CORPUS.md §3.2) and cosine ranking between them is noise.
 *
 * Measured on this corpus, asking *"Why does a low-contrast CTA keep coming up in delivery
 * reports, and what is the rule?"* returns **no** copy of `style-guide-ui.md` in either
 * arm's top 20: the stem `deliveri` is in 89% of documents and `report` in 56%, and between
 * them they pull the whole candidate set into the delivery reports. Drop them from the
 * embedded text and the same document is **rank 1** in the vector arm.
 *
 * **Why the keyword arm keeps the original.** It has the discounting already, and it also
 * has the literal matching that makes a rare term decisive. Rewriting both arms was tried
 * and measured: it fixes the query above and *breaks* "Who runs the delivery review, and
 * can it be someone from the same pod?", where "delivery review" is the name of the process
 * being asked about and the keyword arm was finding it at rank 1 on those exact words. No
 * frequency statistic separates a document-class reference from a proper noun that happens
 * to be common — so the arm that can afford the terms keeps them.
 *
 * **Why "a majority".** Not a tuned number: a term present in more than half the documents
 * cannot narrow the corpus below half, so as a *discriminator* it has already failed. The
 * threshold is the point where a term stops being able to select a minority, not a value
 * chosen because it scored well.
 */
export const MAX_DOCUMENT_FRACTION = 0.5;

export interface TermDocumentCounts {
  /** Documents in the corpus — the denominator. */
  totalDocuments: number;
  /** Documents containing each term, keyed by the term exactly as it was passed in. */
  byTerm: Map<string, number>;
}

export interface QueryRewrite {
  /** The text to embed. Equal to the original when nothing was dropped. */
  text: string;
  /** Terms removed, for the log and the dashboard. Empty when the query was left alone. */
  droppedTerms: string[];
}

/**
 * Removes majority terms from the query text, leaving the rest in their original order.
 *
 * Two things it deliberately does not do. It does not reorder or stem the surviving text —
 * the embedding model reads a phrase, not a bag of words, so the remaining words are handed
 * over as they were written. And it never returns an empty query: if every term is a
 * majority term the original is kept, because a query of nothing embeds to nothing useful
 * and a bad candidate set beats no candidate set.
 */
export function rewriteForVectorArm(query: string, counts: TermDocumentCounts): QueryRewrite {
  if (counts.totalDocuments === 0) return { text: query, droppedTerms: [] };

  const ceiling = counts.totalDocuments * MAX_DOCUMENT_FRACTION;
  const dropped = new Set<string>();

  for (const [term, documentCount] of counts.byTerm) {
    if (documentCount > ceiling) dropped.add(term);
  }

  if (dropped.size === 0) return { text: query, droppedTerms: [] };

  const surviving = splitQueryTerms(query).filter((term) => !dropped.has(term));
  if (surviving.length === 0) return { text: query, droppedTerms: [] };

  // Rebuilt by removing the dropped words from the original string rather than by joining
  // the survivors, so punctuation and casing the model may use are preserved.
  const text = stripTerms(query, dropped);

  return { text, droppedTerms: [...dropped].sort() };
}

/**
 * Deletes whole words from the text, matching case-insensitively on the same token shape
 * `splitQueryTerms` produces — so "low-contrast" is one token and removing "contrast" does
 * not leave "low-" behind.
 *
 * Punctuation attached to a removed word stays. Dropping the comma from "in delivery
 * reports, and what is the rule?" welds two clauses into one run-on, which is a different
 * sentence from the one with the word simply missing — and the embedding reads the
 * sentence.
 */
function stripTerms(query: string, dropped: Set<string>): string {
  return (
    query
      .split(/(\s+)/)
      .map((piece) => {
        if (piece.trim().length === 0) return piece;

        // The word itself, without whatever punctuation surrounds it.
        const word = /^[^\p{L}\p{N}]*(.*?)[^\p{L}\p{N}]*$/u.exec(piece)?.[1] ?? piece;
        const [term] = splitQueryTerms(word);
        if (term === undefined || !dropped.has(term)) return piece;

        return piece.replace(word, "");
      })
      .join("")
      .replace(/\s{2,}/g, " ")
      // Removing "reports" from "reports," leaves the comma stranded behind a space. Closing
      // the gap keeps the result a sentence rather than something visibly machine-edited.
      .replace(/\s+([,.;:!?])/g, "$1")
      .trim()
  );
}
