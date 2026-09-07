"use client";

import { Bar, BarChart, Cell, Tooltip, XAxis, YAxis } from "recharts";
import EmptyState from "@/components/ui/EmptyState";

export interface BudgetBarDatum {
  id: string;
  label: string;
  /** Spend fraction (spent / amount); may exceed 1 when over budget. */
  pct: number;
  status: string;
}

const BAR_FILL: Record<string, string> = {
  ok: "#2DD4A7",
  warn: "#F5A623",
  over: "#F2555A",
};

function barFill(status: string): string {
  return BAR_FILL[status] ?? "#EAF1F7";
}

/**
 * Budget spend bars (fraction of each budget consumed). Bars that exceed
 * 1.0 are clamped visually; the numeric label keeps the true value.
 */
export default function BudgetBars({
  data,
  animate = true,
}: {
  data: BudgetBarDatum[];
  animate?: boolean;
}) {
  if (!data || data.length === 0) {
    return <EmptyState title="No budgets yet" hint="Create a budget to track spend against it." />;
  }
  const plotted = data.map((row) => ({ ...row, plotted: Math.min(row.pct, 1) }));
  return (
    <div className="w-full overflow-x-auto">
      <BarChart
        width={560}
        height={Math.max(160, data.length * 44 + 40)}
        data={plotted}
        layout="vertical"
        accessibilityLayer
        margin={{ top: 8, right: 48, bottom: 0, left: 8 }}
      >
        <XAxis type="number" domain={[0, 1]} hide />
        <YAxis
          type="category"
          dataKey="label"
          width={140}
          tick={{ fill: "#EAF1F7", fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#142433",
            border: "1px solid #142433",
            borderRadius: 8,
            color: "#EAF1F7",
            fontSize: 12,
          }}
          formatter={(value, name, entry) => {
            const row = (entry?.payload ?? {}) as BudgetBarDatum;
            return [`${Math.round(row.pct * 100)}% · ${row.status}`, "Spent"];
          }}
        />
        <Bar dataKey="plotted" name="Spent" radius={[0, 4, 4, 0]} isAnimationActive={animate}>
          {plotted.map((row) => (
            <Cell key={row.id} fill={barFill(row.status)} />
          ))}
        </Bar>
      </BarChart>
      <ul className="sr-only">
        {data.map((row) => (
          <li key={row.id}>
            {row.label}: {Math.round(row.pct * 100)} percent, status {row.status}
          </li>
        ))}
      </ul>
    </div>
  );
}
