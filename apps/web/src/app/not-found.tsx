import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

/**
 * Also what a `USER` sees when they type an admin URL. The wording is deliberately the
 * plain not-found message: saying "this exists but is not yours" would confirm the route
 * to someone probing for it.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <ErrorState
        title="Page not found"
        message="That page does not exist, or you do not have access to it."
        action={
          <Link href="/chat">
            <Button variant="secondary" size="sm">
              Back to chat
            </Button>
          </Link>
        }
      />
    </main>
  );
}
