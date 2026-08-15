import { type ReactNode } from "react";

import { requireSession } from "@/lib/session";

import { AppHeader } from "./app-header";

/**
 * Every page under this layout has a verified session before it renders.
 *
 * `requireSession` calls the API, so this is a real check rather than the cookie-presence
 * guess the middleware makes. Placing it in the layout means a page added to this group
 * later inherits it — the same fail-closed arrangement the API's global guards use.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireSession();

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
