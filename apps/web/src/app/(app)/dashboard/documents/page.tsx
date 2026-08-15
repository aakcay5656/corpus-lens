import { type Metadata } from "next";
import Link from "next/link";
import { type DocumentSummary } from "@corpus-lens/shared/document";
import { type Paginated } from "@corpus-lens/shared/pagination";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { TableWrapper, Td, Th } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { ApiError, apiFetch } from "@/lib/api";
import { formatCount, formatDateTime } from "@/lib/format";
import { requireRole } from "@/lib/session";

import { DocumentFilters } from "./document-filters";

export const metadata: Metadata = { title: "Documents · corpus-lens" };

interface SearchParams {
  page?: string;
  search?: string;
  status?: string;
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole("ADMIN", "/dashboard/documents");
  const params = await searchParams;

  // Rebuilt rather than forwarded verbatim: the API validates these anyway, but passing
  // an arbitrary client query string straight through is how an unintended parameter
  // reaches a backend that happens to understand it.
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set("page", params.page);
  if (params.search !== undefined) query.set("search", params.search);
  if (params.status !== undefined) query.set("status", params.status);

  let page: Paginated<DocumentSummary>;
  try {
    page = await apiFetch<Paginated<DocumentSummary>>(`/documents?${query.toString()}`);
  } catch (error) {
    return (
      <Card>
        <CardBody className="p-0">
          <ErrorState
            title="Could not load documents"
            message={error instanceof ApiError ? error.message : "The API did not respond."}
            requestId={error instanceof ApiError ? error.requestId : null}
          />
        </CardBody>
      </Card>
    );
  }

  const buildHref = (target: number): string => {
    const next = new URLSearchParams(query);
    next.set("page", String(target));
    return `/dashboard/documents?${next.toString()}`;
  };

  return (
    <Card>
      <CardHeader title="Documents" description={`${formatCount(page.total)} in the corpus`} />
      <DocumentFilters />
      <CardBody className="p-0">
        {page.items.length === 0 ? (
          <EmptyState
            title="No documents match"
            description="Try a different search term, or clear the status filter."
          />
        ) : (
          <TableWrapper>
            <thead>
              <tr>
                <Th>Title</Th>
                <Th>Type</Th>
                <Th className="text-right">Chunks</Th>
                <Th>Status</Th>
                <Th>Indexed</Th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((document) => (
                <tr key={document.id} className="hover:bg-surface-raised">
                  <Td className="max-w-0">
                    <Link
                      href={`/dashboard/documents/${document.id}`}
                      className="block truncate text-accent hover:underline"
                    >
                      {document.title}
                    </Link>
                    <span className="block truncate font-mono text-[11px] text-faint">
                      {document.sourcePath}
                    </span>
                  </Td>
                  <Td className="text-xs text-muted">{document.docType ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{document.chunkCount}</Td>
                  <Td>
                    <Badge tone={document.status === "FAILED" ? "danger" : "success"}>
                      {document.status}
                    </Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted">
                    {formatDateTime(document.indexedAt)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrapper>
        )}
      </CardBody>
      <Pagination
        page={page.page}
        pageSize={page.pageSize}
        total={page.total}
        buildHref={buildHref}
      />
    </Card>
  );
}
