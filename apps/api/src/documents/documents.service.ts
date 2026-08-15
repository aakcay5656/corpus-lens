import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { type Database } from "@corpus-lens/db/client";
import { chunks } from "@corpus-lens/db/schema/chunks";
import { documents } from "@corpus-lens/db/schema/documents";
import {
  type DocumentDetail,
  type DocumentListQuery,
  type DocumentSummary,
} from "@corpus-lens/shared/document";
import { type Paginated } from "@corpus-lens/shared/pagination";
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import { DATABASE } from "../database/database.module";

@Injectable()
export class DocumentsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(query: DocumentListQuery): Promise<Paginated<DocumentSummary>> {
    const filters = buildFilters(query);
    const where = filters.length > 0 ? and(...filters) : undefined;

    // Counted with the same predicate as the page, in a separate query. Deriving the
    // total from the returned rows would only ever report the page size.
    const [totals] = await this.db.select({ total: count() }).from(documents).where(where);

    const rows = await this.db
      .select({
        ...summarySelection,
        // Correlated subquery rather than a join with GROUP BY: the page is at most 100
        // rows and this keeps the pagination honest, where a join would multiply rows by
        // chunk count before LIMIT could apply.
        chunkCount: sql<number>`(
          select count(*)::int from ${chunks} where ${chunks.documentId} = ${documents.id}
        )`,
      })
      .from(documents)
      .where(where)
      .orderBy(desc(documents.indexedAt), asc(documents.sourcePath))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return {
      items: rows.map(toSummary),
      page: query.page,
      pageSize: query.pageSize,
      total: totals?.total ?? 0,
    };
  }

  async findOne(id: string): Promise<DocumentDetail> {
    const [row] = await this.db
      .select({
        ...summarySelection,
        chunkCount: sql<number>`(
          select count(*)::int from ${chunks} where ${chunks.documentId} = ${documents.id}
        )`,
      })
      .from(documents)
      .where(eq(documents.id, id));

    if (row === undefined) throw new NotFoundException("Document not found.");

    const chunkRows = await this.db
      .select({
        id: chunks.id,
        ordinal: chunks.ordinal,
        breadcrumb: chunks.breadcrumb,
        content: chunks.content,
        tokenCount: chunks.tokenCount,
        // The vector itself is never selected: 1536 floats per chunk that no client can
        // use, and shipping them would dwarf the content they describe. `isNotNull` is a
        // SQL predicate, so its result type has to be declared for the driver.
        hasEmbedding: sql<boolean>`${chunks.embedding} is not null`,
      })
      .from(chunks)
      .where(eq(chunks.documentId, id))
      .orderBy(asc(chunks.ordinal));

    return { ...toSummary(row), chunks: chunkRows };
  }
}

const summarySelection = {
  id: documents.id,
  sourcePath: documents.sourcePath,
  title: documents.title,
  docType: documents.docType,
  docDate: documents.docDate,
  subject: documents.subject,
  version: documents.version,
  lifecycle: documents.lifecycle,
  status: documents.status,
  tokenCount: documents.tokenCount,
  indexedAt: documents.indexedAt,
  errorMessage: documents.errorMessage,
};

/**
 * The shape both queries select. Written out rather than inferred so that the mapping
 * below is checked structurally against what Drizzle actually returns — a column added to
 * `summarySelection` and forgotten here becomes a compile error, not a missing field.
 */
interface DocumentRow {
  id: string;
  sourcePath: string;
  title: string;
  docType: string | null;
  /** A `date` column: Drizzle hands back the ISO string, not a Date. */
  docDate: string | null;
  subject: string | null;
  version: string | null;
  lifecycle: string | null;
  status: DocumentSummary["status"];
  tokenCount: number | null;
  indexedAt: Date | null;
  errorMessage: string | null;
  chunkCount: number;
}

function toSummary(row: DocumentRow): DocumentSummary {
  return { ...row, indexedAt: row.indexedAt?.toISOString() ?? null };
}

function buildFilters(query: DocumentListQuery): SQL[] {
  const filters: SQL[] = [];

  if (query.search !== undefined && query.search.length > 0) {
    // `ilike` with the term bound as a parameter — the wildcards are ours, the term is
    // never concatenated into SQL.
    const term = `%${escapeLike(query.search)}%`;
    const match = or(ilike(documents.title, term), ilike(documents.sourcePath, term));
    if (match !== undefined) filters.push(match);
  }
  if (query.status !== undefined) filters.push(eq(documents.status, query.status));
  if (query.docType !== undefined) filters.push(eq(documents.docType, query.docType));

  return filters;
}

/**
 * Escapes LIKE metacharacters in a user-supplied term.
 *
 * Without this, searching for `%` matches every document and searching for `_` matches
 * any single character — not an injection, but a filter that silently does not filter.
 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}
