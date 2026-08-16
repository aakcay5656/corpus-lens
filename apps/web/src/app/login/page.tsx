import { type Metadata } from "next";

import { Card, CardBody } from "@/components/ui/card";
import { Logo } from "@/components/ui/logo";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · corpus-lens" };

/**
 * The `next` parameter is validated here as well as in the middleware.
 *
 * The middleware only sees requests it intercepts; this page can also be reached with a
 * hand-written query string. Validating in both places is not duplication — it is the
 * difference between one guarded entrance and a guarded room.
 */
function safeNext(value: string | undefined): string {
  return value !== undefined && value.startsWith("/") && !value.startsWith("//") ? value : "/chat";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="flex items-center justify-center gap-2 text-xl font-semibold text-ink">
            <Logo className="size-6 shrink-0 text-accent" />
            corpus-lens
          </h1>
          <p className="mt-1 text-sm text-muted">
            Search and ask questions about the documentation corpus.
          </p>
        </div>

        <Card>
          <CardBody>
            <LoginForm next={safeNext(next)} />
          </CardBody>
        </Card>

        <p className="mt-4 text-center text-xs text-muted">
          Demo accounts are listed in the project README.
        </p>
      </div>
    </main>
  );
}
