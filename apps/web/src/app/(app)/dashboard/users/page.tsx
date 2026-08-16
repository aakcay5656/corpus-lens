import { type Metadata } from "next";
import { type Paginated } from "@corpus-lens/shared/pagination";
import { type UserSummary } from "@corpus-lens/shared/user";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Pagination } from "@/components/ui/pagination";
import { TableWrapper, Td, Th } from "@/components/ui/table";
import { ApiError, apiFetch } from "@/lib/api";
import { formatCount, formatDateTime } from "@/lib/format";
import { requireRole } from "@/lib/session";

import { CreateUserForm } from "./create-user-form";
import { RoleControl } from "./role-control";

export const metadata: Metadata = { title: "Users · corpus-lens" };

interface SearchParams {
  page?: string;
  search?: string;
  role?: string;
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // The API guards this independently; this decides what to render (CLAUDE.md §9).
  const actor = await requireRole("ADMIN", "/dashboard/users");
  const params = await searchParams;

  // Rebuilt rather than forwarded, for the reason given on the documents page: passing a
  // client query string straight through is how an unintended parameter reaches a backend
  // that happens to understand it.
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set("page", params.page);
  if (params.search !== undefined) query.set("search", params.search);
  if (params.role !== undefined) query.set("role", params.role);

  let page: Paginated<UserSummary>;
  try {
    page = await apiFetch<Paginated<UserSummary>>(`/users?${query.toString()}`);
  } catch (error) {
    return (
      <Card>
        <CardBody className="p-0">
          <ErrorState
            title="Could not load users"
            message={error instanceof ApiError ? error.message : "The API did not respond."}
            requestId={error instanceof ApiError ? error.requestId : null}
          />
        </CardBody>
      </Card>
    );
  }

  const buildHref = (target: number): string => {
    const next = new URLSearchParams(query);
    next.set("page", String(target));
    return `/dashboard/users?${next.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Users"
          description={`${formatCount(page.total)} account${page.total === 1 ? "" : "s"}`}
        />
        <CardBody className="p-0">
          {page.items.length === 0 ? (
            <EmptyState title="No users match" description="Try a different search term." />
          ) : (
            <TableWrapper>
              <thead>
                <tr>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Session</Th>
                  <Th>Created</Th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((user) => (
                  <tr key={user.id} className="hover:bg-surface-raised">
                    <Td className="max-w-0">
                      <span className="block truncate text-ink">{user.email}</span>
                      {user.id === actor.id ? (
                        <span className="block text-[11px] text-faint">this is you</span>
                      ) : null}
                    </Td>
                    <Td>
                      <RoleControl
                        userId={user.id}
                        email={user.email}
                        role={user.role}
                        // Rendered as a plain badge for the signed-in administrator. The
                        // API refuses a self-demotion regardless; disabling the control is
                        // so the refusal is not the first time anyone hears about the rule.
                        editable={user.id !== actor.id}
                      />
                    </Td>
                    <Td>
                      {user.hasActiveSession ? (
                        <Badge tone="success">active</Badge>
                      ) : (
                        <span className="text-xs text-faint">none</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-muted">
                      {formatDateTime(user.createdAt)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrapper>
          )}
        </CardBody>
        <Pagination
          page={page.page}
          pageSize={page.pageSize}
          total={page.total}
          buildHref={buildHref}
        />
      </Card>

      <CreateUserForm />
    </div>
  );
}
