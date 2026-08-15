import { type Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type DocumentDetail } from "@corpus-lens/shared/document";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { StatTile } from "@/components/ui/stat-tile";
import { ApiError, apiFetch } from "@/lib/api";
import { formatCount, formatDate, formatDateTime } from "@/lib/format";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Document · corpus-lens" };

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN", "/dashboard/documents");
  const { id } = await params;

  let document: DocumentDetail;
  try {
    document = await apiFetch<DocumentDetail>(`/documents/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <Card>
        <CardBody className="p-0">
          <ErrorState
            title="Could not load document"
            message={error instanceof ApiError ? error.message : "The API did not respond."}
            requestId={error instanceof ApiError ? error.requestId : null}
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Link href="/dashboard/documents" className="text-xs text-accent hover:underline">
        ← All documents
      </Link>

      <Card>
        <CardHeader
          title={document.title}
          description={document.sourcePath}
          action={
            <Badge tone={document.status === "FAILED" ? "danger" : "success"}>
              {document.status}
            </Badge>
          }
        />
        <CardBody className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Chunks" value={formatCount(document.chunkCount)} />
            <StatTile
              label="Tokens"
              value={document.tokenCount === null ? "—" : formatCount(document.tokenCount)}
            />
            <StatTile
              label="Type"
              value={<span className="text-base">{document.docType ?? "—"}</span>}
            />
            <StatTile
              label="Lifecycle"
              value={<span className="text-base">{document.lifecycle ?? "—"}</span>}
              hint={document.version === null ? undefined : `version ${document.version}`}
              tone={document.lifecycle === "deprecated" ? "warning" : "default"}
            />
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            <Detail label="Date" value={formatDate(document.docDate)} />
            <Detail label="Subject" value={document.subject ?? "—"} />
            <Detail label="Indexed" value={formatDateTime(document.indexedAt)} />
          </dl>

          {document.errorMessage !== null ? (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              {document.errorMessage}
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Chunks"
          description="In reading order, exactly as they are embedded and retrieved"
        />
        <CardBody>
          <ol className="flex flex-col gap-2">
            {document.chunks.map((chunk) => (
              <li key={chunk.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex size-5 items-center justify-center rounded bg-surface-raised text-[11px] tabular-nums text-muted">
                    {chunk.ordinal}
                  </span>
                  {/* A chunk with no embedding is invisible to the vector arm. Flagged
                      per chunk, not only in the aggregate on the overview. */}
                  {chunk.hasEmbedding ? null : <Badge tone="warning">no embedding</Badge>}
                  <span className="ml-auto text-[11px] text-faint">{chunk.tokenCount} tokens</span>
                </div>
                <p className="mt-1.5 break-words font-mono text-[11px] text-faint">
                  {chunk.breadcrumb}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted">
                  {chunk.content}
                </p>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-faint">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
