"use client";

import { Cell, Pie, PieChart, Tooltip } from "recharts";
import type { DonutSlice } from "@/lib/dashboard/transforms";
import EmptyState from "@/components/ui/EmptyState";

const PALETTE = ["#2DD4A7", "#56A8F5", "#8B7CF6", "#F5A623", "#F2555A", "#EAF1F7"];

/**
 * Spend-by-category donut. Shared EmptyState when the aggregate is empty.
 */
export default function CategoryDonut({
  data,
  animate = true,
}: {
  data: DonutSlice[];
  animate?: boolean;
}) {
  if (!data || data.length === 0) {
    return <EmptyState title="No category data yet" hint="Categorized expenses will appear here." />;
  }
  return (
    <div className="w-full overflow-x-auto">
      <PieChart width={360} height={260} accessibilityLayer>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={64}
          outerRadius={96}
          paddingAngle={2}
          isAnimationActive={animate}
        >
          {data.map((slice, index) => (
            <Cell key={slice.id} fill={PALETTE[index % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: "#142433",
            border: "1px solid #142433",
            borderRadius: 8,
            color: "#EAF1F7",
            fontSize: 12,
          }}
        />
      </PieChart>
      <ul className="mt-2 grid grid-cols-2 gap-1">
        {data.map((slice, index) => (
          <li key={slice.id} className="flex items-center gap-2 text-xs text-instrument/70">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: PALETTE[index % PALETTE.length] }}
            />
            <span className="truncate">{slice.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
