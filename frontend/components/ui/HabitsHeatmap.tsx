import type { HeatCell } from "@/lib/productivity/productivity";
import { t } from "@/lib/i18n";

const cellClass: Record<HeatCell, string> = {
  done: "bg-flow",
  missed: "bg-alert",
  pending: "bg-signal",
  empty: "bg-hull",
};

/** Copy ES de cada celda (el heatmap es un derivado del calendario, no una racha). */
const cellKey = {
  done: "productivity.heatmap.done",
  missed: "productivity.heatmap.missed",
  pending: "productivity.heatmap.pending",
  empty: "productivity.heatmap.empty",
} as const;

/**
 * Pure CSS-grid heatmap fed ONLY by real range logs: callers map the
 * 4-state calendar (`logsToCalendarCells` + `calendarStateToHeat`) into
 * `cells`. Streak-derived strips were removed in S2b (single source: logs).
 * All copy comes from typed ES keys — no hardcoded English.
 */
export default function HabitsHeatmap({ cells, label, dates }: { cells: HeatCell[]; label: string; dates?: string[] }) {
  return (
    <div
      role="img"
      aria-label={t("productivity.heatmap.label", { habit: label })}
      className="grid grid-cols-7 justify-start gap-1"
    >
      {cells.map((cell, index) => {
        const date = dates?.[index];
        const state = t(cellKey[cell]);
        const hint = date
          ? `${date}: ${state}`
          : `${t("productivity.heatmap.day", { n: index + 1 })}: ${state}`;
        return (
          <span
            key={date ?? `${label}-${index}`}
            title={hint}
            className={`h-3 w-3 rounded-sm ${cellClass[cell]}`}
          />
        );
      })}
    </div>
  );
}
