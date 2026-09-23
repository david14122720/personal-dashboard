import { ledDotClass } from "@/lib/dashboard/transforms";

/**
 * Stitch KPI card: caps label row with the 1:1 backend LED, big tabular
 * value, optional sub-line, progress track, footer and the bottom gradient
 * hairline. Data stays numeric/strings from the container boundary.
 */

export interface MetricCardProps {
  label: string;
  display: string;
  hint?: string;
  /** Backend enum (ok|warn|high|over). Absent means "no alert applies". */
  status?: string | null;
  /** Progress fill in percent (clamped to 0-100). Null/absent hides the track. */
  bar?: number | null;
  /** Small line rendered under the progress track. */
  footer?: string;
}

export default function MetricCard({ label, display, hint, status, bar, footer }: MetricCardProps) {
  const fill =
    bar === null || bar === undefined || !Number.isFinite(bar)
      ? null
      : Math.min(100, Math.max(0, bar));

  return (
    <article className="relative overflow-hidden rounded-xl border border-slate-800/80 bg-[#0f131d]/90 p-5 transition-colors hover:border-slate-700">
      <div className="flex items-center gap-2">
        {status ? (
          <span
            role="img"
            aria-label={`${label} status ${status}`}
            title={status}
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${ledDotClass(status)}`}
          />
        ) : null}
        <span className="label-caps text-slate-400">{label}</span>
      </div>
      <p className="mt-3 font-mono text-2xl font-semibold tabular-nums tracking-tight text-white">
        {display}
      </p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      {fill === null ? null : (
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-flow to-signal"
            style={{ width: `${fill}%` }}
          />
        </div>
      )}
      {footer ? <p className="mt-2 text-xs text-slate-400">{footer}</p> : null}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-sky-500/40 to-transparent"
      />
    </article>
  );
}
