import { type ReactNode } from "react";

import { cn } from "./cn";

/**
 * A table that scrolls horizontally instead of overflowing the page.
 *
 * The wrapper is the point. A wide table on a 375px viewport either overflows the body —
 * which breaks the whole layout, not just the table — or forces every column to shrink
 * past legibility. Scrolling the table alone keeps the page intact.
 */
export function TableWrapper({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-border px-3 py-2 text-xs font-medium text-muted whitespace-nowrap",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("border-b border-border px-3 py-2 text-ink", className)}>{children}</td>;
}
