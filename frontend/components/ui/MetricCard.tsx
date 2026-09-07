import { ledDotClass } from "@/lib/dashboard/transforms";

/**
 * Single telemetry metric cell: tabular value plus backend-enum LED.
 */

export interface MetricCardProps {
  label: string;
  display: string;
  hint?: string;
  status?: string | null;
}

export default function MetricCard({ label, display, hint, status }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-hull bg-hull/40 p-4">
      <div className="flex items-center gap-2">
        {status ? (
          <span
            role="img"
            aria-label={`${label} status ${status}`}
            title={status}
            className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${ledDotClass(status)}`}
          />
        ) : null}
        <p className="font-display text-xs font-medium uppercase tracking-widest text-instrument/60">
          {label}
        </p>
      </div>
      <p className="mt-2 font-mono text-xl font-semibold tabular-nums text-instrument">{display}</p>
      {hint ? <p className="mt-1 text-xs text-instrument/60">{hint}</p> : null}
    </div>
  );
}
