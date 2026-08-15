"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/components/ui/cn";

/**
 * A client component only because the active link depends on the current path, which is
 * not knowable during a server render of a shared layout.
 */
export function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  const links = [
    { href: "/chat", label: "Chat" },
    ...(isAdmin ? [{ href: "/dashboard", label: "Dashboard" }] : []),
  ];

  return (
    <nav className="flex items-center gap-1" aria-label="Main">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-sm transition-colors sm:px-3",
              active ? "bg-surface-raised font-medium text-ink" : "text-muted hover:text-ink",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
