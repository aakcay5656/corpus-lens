import { cn } from "./cn";

/**
 * The loading state. Sized by the caller to match the content it stands in for, so the
 * layout does not jump when the real thing arrives — a spinner in the middle of an empty
 * page reflows everything the moment data lands.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      // Hidden from assistive technology: it conveys nothing, and the region it fills is
      // announced by whatever replaces it.
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-surface-raised", className)}
    />
  );
}
