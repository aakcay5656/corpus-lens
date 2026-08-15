import { type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "./cn";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Rendered below the field and wired to it with aria-describedby. */
  hint?: ReactNode;
  error?: string;
}

/**
 * Label and input as one component, so they cannot be separated.
 *
 * The `id` is required rather than generated: an explicit id is what ties the label, the
 * hint and the error message together for a screen reader, and a component that silently
 * makes one up hides the omission instead of preventing it.
 */
export function Field({ label, hint, error, id, className, ...props }: FieldProps) {
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error !== undefined}
        aria-describedby={cn(hintId, errorId) || undefined}
        className={cn(
          "h-11 rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-faint",
          "transition-colors focus:border-accent",
          error === undefined ? "border-border" : "border-danger",
          className,
        )}
        {...props}
      />
      {hint !== undefined ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error !== undefined ? (
        // `role="alert"` so the message is announced when it appears, not only when the
        // field is next focused.
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
