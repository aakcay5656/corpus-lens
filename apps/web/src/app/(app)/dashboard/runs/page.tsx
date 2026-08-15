import { type Metadata } from "next";
import Link from "next/link";
import { type IngestionRun } from "@corpus-lens/shared/ingestion";
import { type Paginated } from "@corpus-lens/shared/pagination";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { TableWrapper, Td, Th } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { ApiError, apiFetch } from "@/lib/api";
import { formatDateTime, formatDuration } from "@/lib/format";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Ingestion · corpus-lens" };

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireRole("ADMIN", "/dashboard/runs");
  const { page: pageParam } = await searchParams;

  const query = new URLSearchParams();
  if (pageParam !== undefined) query.set("page", pageParam);

  let page: Paginated<IngestionRun>;
  try {
    page = await apiFetch<Paginated<IngestionRun>>(`/ingest/runs?${query.toString()}`);
  } catch (error) {
    return (
      <Card>
        <CardBody className="p-0">
          <ErrorState
            title="Could not load ingestion runs"
            message={error instanceof ApiError ? error.message : "The API did not respond."}
            requestId={error instanceof ApiError ? error.requestId : null}
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Ingestion runs" description="Most recent first" />
      <CardBody className="p-0">
        {page.items.length === 0 ? (
          <EmptyState
            title="No runs yet"
            description="Trigger one from the overview, or run `pnpm ingest` from a terminal."
          />
        ) : (
          <TableWrapper>
            <thead>
              <tr>
                <Th>Started</Th>
                <Th>Status</Th>
                <Th className="text-right">Added</Th>
                <Th className="text-right">Updated</Th>
                <Th className="text-right">Unchanged</Th>
                <Th className="text-right">Failed</Th>
                <Th className="text-right">Duration</Th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((run) => (
                <tr key={run.id} className="hover:bg-surface-raised">
                  <Td className="whitespace-nowrap">
                    <Link
                      href={`/dashboard/runs/${run.id}`}
                      className="text-accent hover:underline"
                    >
                      {formatDateTime(run.startedAt)}
                    </Link>
                    <span className="block text-[11px] text-faint">{run.trigger}</span>
                  </Td>
                  <Td>
                    <Badge tone={runTone(run.status)}>{run.status}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums">{run.documentsAdded}</Td>
                  <Td className="text-right tabular-nums">{run.documentsUpdated}</Td>
                  <Td className="text-right tabular-nums text-muted">{run.documentsUnchanged}</Td>
                  <Td
                    className={`text-right tabular-nums ${run.documentsFailed > 0 ? "text-danger" : ""}`}
                  >
                    {run.documentsFailed}
                  </Td>
                  <Td className="whitespace-nowrap text-right text-xs text-muted">
                    {formatDuration(run.startedAt, run.finishedAt)}
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
        buildHref={(target) => `/dashboard/runs?page=${target}`}
      />
    </Card>
  );
}

function runTone(status: string): "success" | "danger" | "accent" {
  if (status === "COMPLETED") return "success";
  return status === "FAILED" ? "danger" : "accent";
}
