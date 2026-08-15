"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

/**
 * Signing out has to happen in the browser for the same reason signing in does: the
 * server's `Set-Cookie` clearing the session must reach the browser that holds it.
 *
 * The redirect runs whether or not the request succeeded. Logout that fails closed would
 * leave a user stuck in a session they have asked to end, and the API clears the cookies
 * unconditionally for the same reason.
 */
export function SignOutButton() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut(): Promise<void> {
    setSigningOut(true);
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, { method: "POST", credentials: "include" });
    } catch {
      // Network failure: the local cookies may survive, but the middleware will send the
      // user back to login as soon as they expire. Getting them to the login page now is
      // more useful than an error they cannot act on.
    } finally {
      router.refresh();
      router.push("/login");
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={signOut} loading={signingOut}>
      Sign out
    </Button>
  );
}
