import { type ReactNode } from "react";

/**
 * The empty and error states, as components rather than an inline paragraph in whichever
 * page needed one first.
 *
 * CLAUDE.md §7 requires every view to implement loading, empty and error. Having them as
 * primitives is what makes that cheap enough to actually do — and it keeps an empty
 * dashboard from looking like a broken one, which is the failure these prevent.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {description !== undefined ? (
        <p className="max-w-sm text-sm text-muted">{description}</p>
      ) : null}
      {action !== undefined ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title,
  message,
  requestId,
  action,
}: {
  title: string;
  message: string;
  /** Quoted for the user so a support conversation can start from a server log line. */
  requestId?: string | null;
  action?: ReactNode;
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-medium text-danger">{title}</p>
      <p className="max-w-sm text-sm text-muted">{message}</p>
      {requestId !== undefined && requestId !== null ? (
        <p className="font-mono text-xs text-faint">request {requestId}</p>
      ) : null}
      {action !== undefined ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
