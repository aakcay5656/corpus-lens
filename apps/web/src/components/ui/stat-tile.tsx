import { type ReactNode } from "react";

import { cn } from "./cn";

/**
 * A headline number.
 *
 * Deliberately not a chart. A single current value is a stat tile — rendering it as a
 * one-bar bar chart adds axes and a plot area to communicate one number, which is less
 * legible than the number.
 *
 * `tone` is reserved for state (a non-zero failure count, chunks missing an embedding),
 * never for decoration, and it always ships with the label rather than relying on colour
 * alone to say something is wrong.
 */
type Tone = "default" | "warning" | "danger";

const VALUE_TONES: Record<Tone, string> = {
  default: "text-ink",
  warning: "text-warning",
  danger: "text-danger",
};

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", VALUE_TONES[tone])}>{value}</p>
      {hint !== undefined ? <p className="mt-0.5 text-xs text-faint">{hint}</p> : null}
    </div>
  );
}
