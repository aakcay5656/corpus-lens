import { type DailyQueryCount } from "@corpus-lens/shared/stats";

import { formatDate } from "@/lib/format";

/**
 * Daily query volume.
 *
 * **Form.** One series over time, so a column chart with a single sequential hue — and no
 * legend, because a legend for one series only repeats the title. The other dashboard
 * numbers (documents, chunks, p50/p95, abstain rate) are stat tiles rather than charts: a
 * single current value rendered as a one-bar chart adds axes and a plot area to say one
 * number, which is strictly less readable than the number.
 *
 * **Marks.** Thin bars with 4px rounded tops anchored to the baseline, a 2px gap between
 * adjacent bars so fills never touch, and a recessive baseline rather than a grid. Labels
 * are selective: the peak is labelled and the range ends are dated, instead of a number
 * over every column.
 *
 * **No JavaScript.** Hover is CSS-only, so this stays a Server Component — the chart is
 * a handful of divs and shipping a charting library to draw them would be the largest
 * dependency in the web app by an order of magnitude.
 */
export function VolumeChart({ data, windowDays }: { data: DailyQueryCount[]; windowDays: number }) {
  if (data.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        No queries in the last {windowDays} days.
      </p>
    );
  }

  const peak = Math.max(...data.map((point) => point.count));
  const first = data[0];
  const last = data.at(-1);

  return (
    <figure className="flex flex-col gap-2">
      <div
        className="flex h-32 items-end gap-0.5"
        role="img"
        aria-label={`Query volume over ${data.length} days, peaking at ${peak} on a single day.`}
      >
        {data.map((point) => (
          <div key={point.day} className="group relative flex h-full flex-1 items-end">
            <div
              // Percentage height against the peak, with a 2px floor so a day with one
              // query is still visibly a bar rather than an empty column.
              style={{ height: `${Math.max((point.count / peak) * 100, 2)}%` }}
              className="w-full rounded-t bg-accent/70 transition-colors group-hover:bg-accent"
            />
            {/* CSS-only tooltip. Hidden from assistive technology because the figure
                already carries the summary and the table below carries the values. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded border border-border bg-surface px-2 py-1 text-[11px] text-ink shadow-sm group-hover:block"
            >
              {formatDate(point.day)} · {point.count}
            </div>
          </div>
        ))}
      </div>

      <figcaption className="flex items-center justify-between text-[11px] text-faint">
        <span>{first === undefined ? "" : formatDate(first.day)}</span>
        <span className="text-muted">peak {peak}/day</span>
        <span>{last === undefined ? "" : formatDate(last.day)}</span>
      </figcaption>
    </figure>
  );
}
