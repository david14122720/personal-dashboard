"use client";

import { Cell, LabelList, Pie, PieChart, Tooltip } from "recharts";
import type { DonutSlice } from "@/lib/dashboard/transforms";
import { formatMoney } from "@/lib/api/money";
import { chartToken } from "@/lib/i18n";
import EmptyState from "@/components/ui/EmptyState";

const SLICE_TOKENS = ["--color-flow", "--color-signal", "--color-violet", "--color-sky", "--color-alert", "--color-instrument"] as const;

/** Token-driven slice palette (resolves @theme props, var() fallback off-DOM). */
export function donutPalette(): string[] {
  return SLICE_TOKENS.map((prop) => chartToken(prop) || `var(${prop})`);
}

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
  const palette = donutPalette();
  const tok = (prop: `--color-${string}`): string => chartToken(prop) || `var(${prop})`;
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
            <Cell key={slice.id} fill={palette[index % palette.length]} />
          ))}
          <LabelList dataKey="value" position="outside" formatter={(label) => formatMoney(typeof label === "number" ? label : 0)} />
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: tok("--color-hull"),
            border: `1px solid ${tok("--color-hull")}`,
            borderRadius: 8,
            color: tok("--color-instrument"),
            fontSize: 12,
          }}
          formatter={(value, name) => [formatMoney(typeof value === "number" ? value : 0), name]}
        />
      </PieChart>
      <ul className="mt-2 grid grid-cols-2 gap-1">
        {data.map((slice, index) => (
          <li key={slice.id} className="flex items-center gap-2 text-xs text-instrument/70">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: palette[index % palette.length] }}
            />
            <span className="truncate">{slice.name} · {formatMoney(slice.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
