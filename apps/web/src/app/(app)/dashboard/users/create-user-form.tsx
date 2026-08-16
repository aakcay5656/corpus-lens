"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { type ErrorEnvelope } from "@corpus-lens/shared/error";
import { PASSWORD_MIN_LENGTH } from "@corpus-lens/shared/limits";
import { ROLES, type Role } from "@corpus-lens/shared/role";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/input";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

/**
 * Creates an account, by posting to `POST /auth/register`.
 *
 * There is no create endpoint on `/users`, deliberately: registration already owns
 * argon2id hashing, email normalisation, the duplicate check and the admin guard, and a
 * second entry point would be a second copy of those rules — the copy that gets forgotten
 * when one of them changes.
 *
 * The password is typed by an administrator rather than generated here. A generated one
 * would have to be shown on screen and copied out of band, which is a worse handling story
 * than the browser's own password manager offering to save what was typed.
 */
export function CreateUserForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("USER");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setCreated(null);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, role }),
        credentials: "include",
      });

      if (!response.ok) {
        const body = (await response.json()) as Partial<ErrorEnvelope>;
        // Carries the real reason — a duplicate email, or a password under the minimum —
        // which is what makes the form correctable rather than merely refused.
        setError(body.error?.message ?? "Could not create the account.");
        return;
      }

      setCreated(email.trim());
      setEmail("");
      setPassword("");
      setRole("USER");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Add a user"
        description="Accounts are created by an administrator; there is no self-registration."
      />
      <CardBody>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id="new-user-email"
              label="Email"
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Field
              id="new-user-password"
              label="Password"
              type="password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete="new-password"
              hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="new-user-role" className="text-xs font-medium text-muted">
                Role
              </label>
              <select
                id="new-user-role"
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
              >
                {ROLES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <Button type="submit" size="sm" loading={saving}>
              Create account
            </Button>
          </div>

          {error !== null ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
          {created !== null ? (
            <p role="status" className="text-xs text-success">
              Created {created}. They can sign in now.
            </p>
          ) : null}
        </form>
      </CardBody>
    </Card>
  );
}
