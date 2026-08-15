"use client";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

/**
 * The last-resort error boundary.
 *
 * `error.digest` is deliberately the only identifier shown. Next replaces a server error's
 * message with a generic one in production precisely so the client cannot read it, and
 * the digest is the handle that correlates to the real message in the server log — the
 * same arrangement as the API's request id.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <ErrorState
        title="Something went wrong"
        message="The page could not be loaded. Trying again may help."
        requestId={error.digest ?? null}
        action={
          <Button variant="secondary" size="sm" onClick={reset}>
            Try again
          </Button>
        }
      />
    </main>
  );
}
