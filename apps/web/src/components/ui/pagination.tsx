import Link from "next/link";

import { cn } from "./cn";

/**
 * Page links rather than buttons, so pagination is bookmarkable, works without
 * JavaScript, and lets the page stay a Server Component.
 */
export function Pagination({
  page,
  pageSize,
  total,
  buildHref,
}: {
  page: number;
  pageSize: number;
  total: number;
  buildHref: (page: number) => string;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-muted sm:px-5">
      <span className="tabular-nums">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <PageLink href={buildHref(page - 1)} disabled={page <= 1}>
          Previous
        </PageLink>
        <span className="px-2 tabular-nums">
          {page} / {lastPage}
        </span>
        <PageLink href={buildHref(page + 1)} disabled={page >= lastPage}>
          Next
        </PageLink>
      </div>
    </div>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: string;
}) {
  const className = cn(
    "rounded-lg border border-border px-2.5 py-1.5",
    disabled ? "cursor-not-allowed opacity-50" : "hover:bg-surface-raised hover:text-ink",
  );

  // A disabled control must not be a link: it would still be focusable and clickable.
  if (disabled) {
    return (
      <span aria-disabled="true" className={className}>
        {children}
      </span>
    );
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
