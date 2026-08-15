/**
 * Display formatting, in one place.
 *
 * Dates render in a fixed locale rather than the visitor's. A Server Component formats
 * on the server and the browser rehydrates it: if the two disagree about locale or time
 * zone — and they routinely do — React reports a hydration mismatch and replaces the
 * markup. Pinning the locale makes the two renders identical by construction.
 */
const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const DATE = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });

export function formatDateTime(value: string | null): string {
  if (value === null) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : `${DATE_TIME.format(parsed)} UTC`;
}

export function formatDate(value: string | null): string {
  if (value === null) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : DATE.format(parsed);
}

/** Milliseconds, switching to seconds past a point where four digits stop being readable. */
export function formatMs(value: number | null): string {
  if (value === null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

/** A 0–1 ratio as a percentage. Null stays "—": no data is not zero percent. */
export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

/** Duration between two instants, for a finished ingestion run. */
export function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (finishedAt === null) return "running";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
