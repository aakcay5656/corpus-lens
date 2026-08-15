"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { type IngestionRun } from "@corpus-lens/shared/ingestion";

import { Button } from "@/components/ui/button";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

/**
 * Triggers an ingestion run and follows it to completion.
 *
 * `POST /ingest` answers 202 with the run row rather than the result — a full pass takes
 * about a minute — so the button's job after that is polling. Every poll refreshes the
 * server-rendered page beneath it, which is what makes the counts and the run list update
 * live without any of them becoming client state.
 */
export function RunIngestionButton({ initialRunning }: { initialRunning: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(initialRunning);
  const [error, setError] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);

  // The interval is cleared on unmount as well as on completion: navigating away
  // mid-run would otherwise leave it polling and refreshing a page nobody is looking at.
  useEffect(() => {
    if (!running) return undefined;

    const interval = setInterval(() => {
      void (async () => {
        try {
          const id = runIdRef.current;
          const path = id === null ? "/ingest/runs?pageSize=1" : `/ingest/runs/${id}`;
          const response = await fetch(`${API_BASE_URL}${path}`, { credentials: "include" });
          if (!response.ok) return;

          const body = (await response.json()) as IngestionRun | { items: IngestionRun[] };
          const run = "items" in body ? body.items[0] : body;
          if (run !== undefined && run.status !== "RUNNING") setRunning(false);

          router.refresh();
        } catch {
          // A failed poll is not a failed run. The next tick tries again, and stopping
          // here would leave the button stuck reporting "running" forever.
        }
      })();
    }, 2000);

    return () => clearInterval(interval);
  }, [running, router]);

  async function trigger(): Promise<void> {
    setError(null);
    setRunning(true);
    try {
      const response = await fetch(`${API_BASE_URL}/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: false }),
        credentials: "include",
      });

      if (!response.ok) {
        setRunning(false);
        setError("Could not start ingestion.");
        return;
      }

      const run = (await response.json()) as IngestionRun;
      runIdRef.current = run.id;
      router.refresh();
    } catch {
      setRunning(false);
      setError("Could not reach the server.");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="secondary" onClick={trigger} loading={running}>
        {running ? "Ingesting…" : "Run ingestion"}
      </Button>
      {error !== null ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
