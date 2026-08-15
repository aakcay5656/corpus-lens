import { type ReactNode } from "react";

import { DashboardNav } from "./dashboard-nav";

/**
 * Sub-navigation only — deliberately **no authorization check**.
 *
 * The lesson from Step 10: React builds a layout's children before the layout resolves,
 * so a gate here would run alongside the pages rather than in front of them and would not
 * stop a protected page from rendering. The role is enforced in the middleware (before
 * anything renders) and again in each page.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <DashboardNav />
      {children}
    </div>
  );
}
