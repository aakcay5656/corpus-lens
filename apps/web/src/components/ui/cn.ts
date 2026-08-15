/**
 * Joins class names, dropping anything falsy.
 *
 * Deliberately not `clsx` or `tailwind-merge`. Every component below owns its own classes
 * and none of them are conditionally overridden by a caller, so there is no conflict to
 * resolve — the four lines that remain are the whole requirement (CLAUDE.md §2.6).
 */
export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}
