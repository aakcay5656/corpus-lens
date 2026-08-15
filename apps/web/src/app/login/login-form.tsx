"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { loginRequestSchema } from "@corpus-lens/shared/auth";
import { type ErrorEnvelope } from "@corpus-lens/shared/error";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";

/**
 * The only component in the app that talks to the API from the browser.
 *
 * It has to: login is what *sets* the cookies, so it cannot be done by the server
 * renderer on the user's behalf — the `Set-Cookie` has to reach the browser directly.
 * `credentials: "include"` is what makes that happen across the two ports, and the API
 * allows exactly this one origin (never `*`, which is incompatible with credentials).
 *
 * Everything after this point is server-rendered with the cookie forwarded, so this is
 * the only place a token-bearing response touches client-side JavaScript — and even here
 * the token is in a header the script cannot read.
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    // The same schema the API validates with, so an obviously malformed address is caught
    // without a round trip and the message matches what the server would have said.
    const parsed = loginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your email and password.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
        // Without this the browser neither sends nor stores the cookies, and login
        // silently succeeds while leaving the user logged out.
        credentials: "include",
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorEnvelope | null;
        setError(body?.error.message ?? "Could not sign in.");
        return;
      }

      // `refresh()` before `push()`: the layout is a Server Component and has already
      // rendered once as anonymous. Without the refresh the navigation reuses that cached
      // render and the header shows no user until a manual reload.
      router.refresh();
      router.push(next);
    } catch {
      // A network-level failure, so there is no envelope to read and no detail worth
      // inventing. The API being down and the laptop being offline look identical here.
      setError("Could not reach the server. Check that the API is running.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Button type="submit" loading={submitting} className="w-full">
        Sign in
      </Button>
    </form>
  );
}
