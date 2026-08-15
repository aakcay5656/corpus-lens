import { boolean, index, integer, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * One row per search or answer request. CLAUDE.md §6: the dashboard analytics are a read
 * over this table, not a separate metrics system.
 *
 * The latency split is stored as separate columns rather than a single total because the
 * useful operational question is *which* stage is slow — a slow embed call and a slow LLM
 * call have nothing in common.
 */
export const searchQueries = pgTable(
  "search_queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * Nullable and ON DELETE SET NULL: deleting a user must not delete the analytics
     * history, and a query's usefulness as a metric does not depend on who asked it.
     */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),

    queryText: text("query_text").notNull(),

    /** "search" for passages only, "answer" for the grounded RAG path. */
    endpoint: text("endpoint").notNull(),

    /** Requested top-k, after the API has clamped it to its allowed range. */
    topK: integer("top_k").notNull(),

    embedMs: integer("embed_ms"),
    retrieveMs: integer("retrieve_ms"),
    /** Null on the search endpoint, and on answers short-circuited by the score floor. */
    generateMs: integer("generate_ms"),
    totalMs: integer("total_ms").notNull(),

    resultCount: integer("result_count").notNull().default(0),

    /** Best fused score. Null when nothing was retrieved — a zero-result query. */
    topScore: real("top_score"),

    /**
     * False when the system declined to answer. First-class column, not derived from the
     * answer text, so the abstain rate is a metric rather than a string search.
     */
    answered: boolean("answered").notNull().default(true),

    /** Which chunks were put in front of the model, for auditing a specific answer. */
    chunkIds: uuid("chunk_ids").array(),

    /**
     * Citation markers the model wrote that pointed at no supplied source, dropped by the
     * validator before the answer was returned.
     *
     * Recorded because it is the earliest signal that generation has regressed: a prompt
     * change or a larger context that starts producing invented references shows up here
     * long before anyone notices a wrong answer, since the validator hides the symptom by
     * design.
     */
    droppedMarkers: integer("dropped_markers").array(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Query volume over time, the dashboard's primary chart.
    index("search_queries_created_at_idx").on(table.createdAt.desc()),

    // "Where does the corpus have gaps" — the abstained and zero-result lists.
    index("search_queries_answered_idx").on(table.answered),
  ],
);
