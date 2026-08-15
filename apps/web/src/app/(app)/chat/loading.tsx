import { Skeleton } from "@/components/ui/skeleton";

/**
 * A route-level loading state, on the one route that can have one.
 *
 * A `loading.tsx` creates a Suspense boundary, and once a boundary has flushed the shell
 * the status line is already written — so `notFound()` on any page beneath it can no
 * longer produce a 404 and a missing document answers 200. The dashboard's detail pages
 * depend on that status being right, so they get no boundary; chat has no not-found path,
 * so it can have one.
 *
 * Nothing is lost on the dashboard: those pages are server-rendered in tens of
 * milliseconds and the browser holds the previous view until they arrive. The loading
 * states that matter there are in the components that actually wait — the streaming
 * answer skeleton and the ingestion button's spinner.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-full max-w-md" />
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
  );
}
