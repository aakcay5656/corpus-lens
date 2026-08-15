import { type Metadata } from "next";
import Link from "next/link";
import { type StatsResponse } from "@corpus-lens/shared/stats";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { StatTile } from "@/components/ui/stat-tile";
import { TableWrapper, Td, Th } from "@/components/ui/table";
import { ApiError, apiFetch } from "@/lib/api";
import { formatCount, formatDateTime, formatMs, formatPercent } from "@/lib/format";
import { requireRole } from "@/lib/session";

import { RunIngestionButton } from "./run-ingestion-button";
import { VolumeChart } from "./volume-chart";

export const metadata: Metadata = { title: "Dashboard · corpus-lens" };

export default async function DashboardPage() {
  await requireRole("ADMIN", "/dashboard");

  let stats: StatsResponse;
  try {
    stats = await apiFetch<StatsResponse>("/stats");
  } catch (error) {
    // The error state is a real branch, not a fallback nobody sees: the dashboard is the
    // first page to break when the database is unreachable, and a blank page would be
    // indistinguishable from an empty corpus.
    return (
      <Card>
        <CardBody className="p-0">
          <ErrorState
            title="Could not load statistics"
            message={error instanceof ApiError ? error.message : "The API did not respond."}
            requestId={error instanceof ApiError ? error.requestId : null}
          />
        </CardBody>
      </Card>
    );
  }

  const { corpus, queries, lastRun } = stats;
  const indexHealthy = corpus.chunksMissingEmbedding === 0 && corpus.documentsFailed === 0;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Index health"
          description={`Last indexed ${formatDateTime(corpus.lastIndexedAt)}`}
          action={<RunIngestionButton initialRunning={lastRun?.status === "RUNNING"} />}
        />
        <CardBody>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Documents"
              value={formatCount(corpus.documents)}
              hint={`${formatCount(corpus.documentsIndexed)} indexed`}
            />
            <StatTile
              label="Chunks"
              value={formatCount(corpus.chunks)}
              hint={`${formatCount(corpus.totalTokens)} tokens`}
            />
            <StatTile
              label="Failed documents"
              value={formatCount(corpus.documentsFailed)}
              tone={corpus.documentsFailed > 0 ? "danger" : "default"}
              hint={corpus.documentsFailed > 0 ? "See Documents" : "None"}
            />
            <StatTile
              label="Missing embeddings"
              value={formatCount(corpus.chunksMissingEmbedding)}
              // Its own tile rather than a footnote: a chunk with no vector is invisible
              // to the vector arm, so retrieval is quietly incomplete and nothing else in
              // the system would say so.
              tone={corpus.chunksMissingEmbedding > 0 ? "warning" : "default"}
              hint={indexHealthy ? "Index complete" : "Retrieval is incomplete"}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Search activity" description={`Last ${stats.windowDays} days`} />
        <CardBody className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Queries"
              value={formatCount(queries.total)}
              hint={`${formatCount(queries.searches)} search · ${formatCount(queries.answers)} answer`}
            />
            <StatTile label="p50 latency" value={formatMs(queries.p50TotalMs)} />
            <StatTile
              label="p95 latency"
              value={formatMs(queries.p95TotalMs)}
              hint="Tail, not average"
            />
            <StatTile
              label="Abstain rate"
              value={formatPercent(queries.abstainRate)}
              // Null renders as "—" rather than 0%: no questions asked and no questions
              // refused are different facts.
              hint={
                queries.abstainRate === null
                  ? "No answers yet"
                  : "Questions the corpus could not answer"
              }
            />
          </div>

          <VolumeChart data={stats.volumeByDay} windowDays={stats.windowDays} />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top queries" description="Most asked, with average top score" />
          <CardBody className="p-0">
            {stats.topQueries.length === 0 ? (
              <EmptyState title="No queries yet" description="Ask something on the chat page." />
            ) : (
              <TableWrapper>
                <thead>
                  <tr>
                    <Th>Query</Th>
                    <Th className="text-right">Count</Th>
                    <Th className="text-right">Avg score</Th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topQueries.map((query) => (
                    <tr key={query.queryText}>
                      <Td className="max-w-0 truncate text-xs">{query.queryText}</Td>
                      <Td className="text-right tabular-nums">{query.count}</Td>
                      <Td className="text-right tabular-nums text-muted">
                        {query.averageTopScore === null ? "—" : query.averageTopScore.toFixed(4)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrapper>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Zero-result queries"
            description="Questions that retrieved nothing — where the corpus has a gap"
          />
          <CardBody className="p-0">
            {stats.zeroResultQueries.length === 0 ? (
              <EmptyState
                title="None"
                description="Every query so far retrieved at least one passage."
              />
            ) : (
              <TableWrapper>
                <thead>
                  <tr>
                    <Th>Query</Th>
                    <Th className="text-right">Count</Th>
                  </tr>
                </thead>
                <tbody>
                  {stats.zeroResultQueries.map((query) => (
                    <tr key={query.queryText}>
                      <Td className="max-w-0 truncate text-xs">{query.queryText}</Td>
                      <Td className="text-right tabular-nums">{query.count}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrapper>
            )}
          </CardBody>
        </Card>
      </div>

      {lastRun !== null ? (
        <Card>
          <CardHeader
            title="Last ingestion run"
            description={formatDateTime(lastRun.startedAt)}
            action={
              <Link
                href={`/dashboard/runs/${lastRun.id}`}
                className="text-xs text-accent hover:underline"
              >
                View run
              </Link>
            }
          />
          <CardBody className="flex flex-wrap items-center gap-3 text-sm">
            <Badge tone={runTone(lastRun.status)}>{lastRun.status}</Badge>
            <span className="text-muted">
              {lastRun.documentsAdded} added · {lastRun.documentsUpdated} updated ·{" "}
              {lastRun.documentsFailed} failed
            </span>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function runTone(status: string): "success" | "danger" | "accent" {
  if (status === "COMPLETED") return "success";
  return status === "FAILED" ? "danger" : "accent";
}
