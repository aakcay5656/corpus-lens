"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { type ErrorEnvelope } from "@corpus-lens/shared/error";
import { ROLES, type Role } from "@corpus-lens/shared/role";

import { Badge } from "@/components/ui/badge";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

/**
 * Changes one user's role.
 *
 * A select that submits on change rather than a select plus a save button: there is one
 * field and two values, so a second click would only be ceremony. The trade is that a
 * misclick takes effect immediately, which is why the confirmation names the account —
 * "Make user@demo.local an ADMIN?" is checkable, "Are you sure?" is not.
 *
 * On success the server component is refreshed rather than the row being patched in place.
 * The row shows a session column that this action also changes (the API revokes the user's
 * refresh tokens), and re-rendering from the server is how that stays true instead of
 * merely looking true.
 */
interface RoleControlProps {
  userId: string;
  email: string;
  role: Role;
  editable: boolean;
}

export function RoleControl({ userId, email, role, editable }: RoleControlProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editable) {
    return <Badge tone={role === "ADMIN" ? "accent" : undefined}>{role}</Badge>;
  }

  async function change(next: Role): Promise<void> {
    if (next === role) return;
    if (!window.confirm(`Make ${email} ${next === "ADMIN" ? "an ADMIN" : "a USER"}?`)) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/users/${userId}/role`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: next }),
        credentials: "include",
      });

      if (!response.ok) {
        // The API's message is already safe to display — it has guaranteed there is no
        // SQL, stack or provider text in it — and here it carries the actual rule that was
        // broken ("There must be at least one administrator"), which a generic string
        // would throw away.
        const body = (await response.json()) as Partial<ErrorEnvelope>;
        setError(body.error?.message ?? "Could not change the role.");
        return;
      }

      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="sr-only" htmlFor={`role-${userId}`}>
        Role for {email}
      </label>
      <select
        id={`role-${userId}`}
        value={role}
        disabled={saving}
        onChange={(event) => void change(event.target.value as Role)}
        className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-ink disabled:opacity-60"
      >
        {ROLES.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      {error !== null ? (
        <p role="alert" className="text-[11px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
