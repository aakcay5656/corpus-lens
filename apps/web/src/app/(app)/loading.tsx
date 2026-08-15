import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while a Server Component in this group awaits the API. Sized to the pages it
 * stands in for so the layout does not jump when the real content arrives.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-full max-w-md" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
