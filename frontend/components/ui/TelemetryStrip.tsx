import { ledDotClass } from "@/lib/dashboard/transforms";

/**
 * Full-width telemetry strip: net worth, month balance, savings rate,
 * longest streak, and budget/card status LEDs. Every LED maps its backend
 * enum 1:1 — account `alert_level` (ok|warn|high) and budget `status`
 * (ok|warn|over) — to the documented visual state.
 */

export interface TelemetryItem {
  id: string;
  label: string;
  display: string;
  /** Backend enum (ok|warn|high|over). Absent means "no alert applies". */
  status?: string | null;
}

export default function TelemetryStrip({ items }: { items: TelemetryItem[] }) {
  return (
    <section aria-label="Telemetry strip" className="rounded-xl border border-hull bg-deck p-4">
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {items.map((item) => (
          <li key={item.id} className="flex min-w-0 items-start gap-2.5">
            {item.status ? (
              <span
                role="img"
                aria-label={`${item.label} status ${item.status}`}
                title={item.status}
                className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${ledDotClass(item.status)}`}
              />
            ) : (
              <span aria-hidden="true" className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="font-display text-[11px] font-medium uppercase tracking-widest text-instrument/60">
                {item.label}
              </p>
              <p className="truncate font-mono text-base font-semibold tabular-nums text-instrument">
                {item.display}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
