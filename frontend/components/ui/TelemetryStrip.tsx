import { t } from "@/lib/i18n";
import { ledDotClass } from "@/lib/dashboard/transforms";

/**
 * Full-width telemetry strip: labelled KPIs with optional status LEDs.
 * Every LED maps its backend enum 1:1 — account `alert_level`
 * (ok|warn|high) — to the documented visual state. (Slice S2 removed the
 * budget status LED; no budget item may be passed.)
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
    <section
      aria-label={t("dashboard.telemetryStrip")}
      className="rounded-xl border border-slate-800/80 bg-[#0f131d]/60 p-4"
    >
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {items.map((item) => (
          <li key={item.id} className="flex min-w-0 items-start gap-2.5">
            {item.status ? (
              <span
                role="img"
                aria-label={t("dashboard.telemetryStatus", { label: item.label, status: item.status })}
                title={item.status}
                className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${ledDotClass(item.status)}`}
              />
            ) : (
              <span aria-hidden="true" className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="label-caps text-slate-400">{item.label}</p>
              <p className="truncate font-mono text-base font-semibold tabular-nums text-white">
                {item.display}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
