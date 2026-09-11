import type { HeatCell } from "@/lib/productivity/productivity";

const cellClass: Record<HeatCell, string> = {
  done: "bg-flow",
  missed: "bg-alert",
  pending: "bg-signal",
  empty: "bg-hull",
};

/**
 * Pure CSS-grid heatmap fed ONLY by real range logs: callers map the
 * 4-state calendar (`logsToCalendarCells` + `calendarStateToHeat`) into
 * `cells`. Streak-derived strips were removed in S2b (single source: logs).
 */
export default function HabitsHeatmap({ cells, label, dates }: { cells: HeatCell[]; label: string; dates?: string[] }) {
  return (
    <div
      role="img"
      aria-label={`${label} recent completions`}
      className="grid grid-cols-7 justify-start gap-1"
    >
      {cells.map((cell, index) => {
        const date = dates?.[index];
        const hint = date ? `${label} ${date}: ${cell}` : `${label} day ${index + 1}: ${cell}`;
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
