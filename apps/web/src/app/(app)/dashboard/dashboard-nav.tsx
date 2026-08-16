"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";

const LINKS = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/documents", label: "Documents", exact: false },
  { href: "/dashboard/runs", label: "Ingestion", exact: false },
  { href: "/dashboard/users", label: "Users", exact: false },
];

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="mr-1 text-lg font-semibold text-ink">Dashboard</h1>
      <Badge tone="accent">Admin</Badge>

      <nav
        aria-label="Dashboard sections"
        className="ml-auto flex items-center gap-1 overflow-x-auto"
      >
        {LINKS.map((link) => {
          const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                active ? "bg-surface-raised font-medium text-ink" : "text-muted hover:text-ink",
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
