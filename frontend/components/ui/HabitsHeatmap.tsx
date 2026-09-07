import type { HeatCell } from "@/lib/productivity/productivity";

const cellClass: Record<HeatCell, string> = {
  done: "bg-flow",
  missed: "bg-alert",
  pending: "bg-signal",
  empty: "bg-hull",
};

/**
 * Pure CSS-grid heatmap of recent habit completions (no chart library).
 * Fixed 7-column grid with fixed-size cells keeps dates aligned; the strip
 * is oldest → newest left to right, top to bottom.
 */
export default function HabitsHeatmap({ cells, label }: { cells: HeatCell[]; label: string }) {
  return (
    <div
      role="img"
      aria-label={`${label} recent completions`}
      className="grid grid-cols-7 justify-start gap-1"
    >
      {cells.map((cell, index) => (
        <span
          key={`${label}-${index}`}
          title={`${label} day ${index + 1}: ${cell}`}
          className={`h-3 w-3 rounded-sm ${cellClass[cell]}`}
        />
      ))}
    </div>
  );
}
