import { type Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type IngestionRunDetail } from "@corpus-lens/shared/ingestion";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { StatTile } from "@/components/ui/stat-tile";
import { ApiError, apiFetch } from "@/lib/api";
import { formatDateTime, formatDuration } from "@/lib/format";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Ingestion run · corpus-lens" };

/** The API caps a run's events at this many; the UI has to say so rather than imply completeness. */
const EVENT_LIMIT = 500;

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN", "/dashboard/runs");
  const { id } = await params;

  let run: IngestionRunDetail;
  try {
    run = await apiFetch<IngestionRunDetail>(`/ingest/runs/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <Card>
        <CardBody className="p-0">
          <ErrorState
            title="Could not load run"
            message={error instanceof ApiError ? error.message : "The API did not respond."}
            requestId={error instanceof ApiError ? error.requestId : null}
          />
        </CardBody>
      </Card>
    );
  }

  const problems = run.events.filter((event) => event.level !== "INFO");

  return (
    <div className="flex flex-col gap-4">
      <Link href="/dashboard/runs" className="text-xs text-accent hover:underline">
        ← All runs
      </Link>

      <Card>
        <CardHeader
          title={formatDateTime(run.startedAt)}
          description={`${run.trigger} · ${run.corpusDir}`}
          action={<Badge tone={runTone(run.status)}>{run.status}</Badge>}
        />
        <CardBody className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Added" value={run.documentsAdded} />
            <StatTile label="Updated" value={run.documentsUpdated} />
            <StatTile
              label="Unchanged"
              value={run.documentsUnchanged}
              hint="Skipped by content hash"
            />
            <StatTile
              label="Failed"
              value={run.documentsFailed}
              tone={run.documentsFailed > 0 ? "danger" : "default"}
            />
          </div>
          <p className="text-xs text-muted">
            {run.chunksWritten} chunks written · {run.documentsRemoved} removed · took{" "}
            {formatDuration(run.startedAt, run.finishedAt)}
          </p>
          {run.errorMessage !== null ? (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              {run.errorMessage}
            </p>
          ) : null}
        </CardBody>
      </Card>

      {problems.length > 0 ? (
        <Card>
          <CardHeader
            title="Warnings and errors"
            description={`${problems.length} of ${run.events.length} events`}
          />
          <CardBody className="p-0">
            <EventList events={problems} />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="All events"
          description={
            run.events.length >= EVENT_LIMIT
              ? `Showing the first ${EVENT_LIMIT} — the run produced more`
              : `${run.events.length} events, oldest first`
          }
        />
        <CardBody className="p-0">
          {run.events.length === 0 ? (
            <EmptyState title="No events recorded" />
          ) : (
            <EventList events={run.events} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function EventList({ events }: { events: IngestionRunDetail["events"] }) {
  return (
    <ul className="divide-y divide-border">
      {events.map((event) => (
        <li
          key={event.id}
          className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-2 sm:px-5"
        >
          <Badge tone={levelTone(event.level)}>{event.level}</Badge>
          <span className="font-mono text-[11px] text-faint">{event.phase}</span>
          {event.sourcePath !== null ? (
            <span className="max-w-full truncate font-mono text-[11px] text-muted">
              {event.sourcePath}
            </span>
          ) : null}
          <span className="w-full break-words text-xs text-ink sm:w-auto sm:flex-1">
            {event.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

function levelTone(level: string): "neutral" | "warning" | "danger" {
  if (level === "ERROR") return "danger";
  return level === "WARN" ? "warning" : "neutral";
}

function runTone(status: string): "success" | "danger" | "accent" {
  if (status === "COMPLETED") return "success";
  return status === "FAILED" ? "danger" : "accent";
}
