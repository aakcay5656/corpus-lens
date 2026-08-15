import { type Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Dashboard · corpus-lens" };

/**
 * Admin-only, twice over.
 *
 * The middleware has already redirected a `USER` before this file was reached, but the
 * check is repeated here because the middleware's matcher is a configuration line that
 * someone can narrow by accident. This one is *in the page*, not in a layout: React
 * builds a layout's children before the layout resolves, so a gate in a layout runs
 * alongside the page rather than in front of it — which is how the dashboard's markup
 * ended up in a USER's payload the first time this was written.
 *
 * Step 12 fills this in with the document table, ingestion runs and search analytics.
 */
export default async function DashboardPage() {
  await requireRole("ADMIN", "/dashboard");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-ink">Dashboard</h1>
        <Badge tone="accent">Admin</Badge>
      </div>

      <Card>
        <CardHeader title="Corpus and analytics" description="Arrives in the next steps" />
        <CardBody className="p-0">
          <EmptyState
            title="Nothing here yet"
            description="Documents, ingestion runs and search analytics land here in Step 12."
          />
        </CardBody>
      </Card>
    </div>
  );
}
