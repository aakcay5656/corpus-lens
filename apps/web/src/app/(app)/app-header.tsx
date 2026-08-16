import Link from "next/link";
import { type User } from "@corpus-lens/shared/auth";

import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/ui/logo";

import { NavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";

/**
 * The role-aware navigation.
 *
 * The Dashboard link is hidden from a `USER`, and that is a *convenience*, not a control:
 * typing the URL is met by `requireRole` on the page and by `@Roles("ADMIN")` on every
 * endpoint behind it. CLAUDE.md §9 — hiding a nav link is not authorization, so the link
 * is hidden for tidiness and the door is locked separately.
 */
export function AppHeader({ user }: { user: User }) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/chat" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Logo className="size-5 shrink-0 text-accent" />
          corpus-lens
        </Link>

        <NavLinks isAdmin={user.role === "ADMIN"} />

        <div className="ml-auto flex items-center gap-2">
          {/* Hidden below `sm`: on a 375px viewport the email crowds out the navigation,
              and the role badge already says which account is in use. */}
          <span className="hidden text-xs text-muted sm:inline">{user.email}</span>
          <Badge tone={user.role === "ADMIN" ? "accent" : "neutral"}>{user.role}</Badge>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
