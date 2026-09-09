"use client";

import { Bar, BarChart, Cell, LabelList, Tooltip, XAxis, YAxis } from "recharts";
import { chartToken } from "@/lib/i18n";
import EmptyState from "@/components/ui/EmptyState";

export interface BudgetBarDatum {
  id: string;
  label: string;
  /** Spend fraction (spent / amount); may exceed 1 when over budget. */
  pct: number;
  status: string;
}

/** Token-driven bar fill by budget status (ok→flow, warn→signal, over→alert). */
/** Direct bar value label: spend fraction → "120%". Rendered via LabelList. */
export function budgetBarLabel(pct: number): string {
  return `${Math.round(Number(pct ?? 0) * 100)}%`;
}
const BAR_TOKEN: Record<string, `--color-${string}`> = { ok: "--color-flow", warn: "--color-signal", over: "--color-alert" };
export function budgetBarFill(status: string): string {
  const prop = BAR_TOKEN[status] ?? "--color-instrument";
  return chartToken(prop) || `var(${prop})`;
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
  const tok = (prop: `--color-${string}`): string => chartToken(prop) || `var(${prop})`;
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
          tick={{ fill: tok("--color-instrument"), fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: tok("--color-hull"),
            border: `1px solid ${tok("--color-hull")}`,
            borderRadius: 8,
            color: tok("--color-instrument"),
            fontSize: 12,
          }}
          formatter={(value, name, entry) => {
            const row = (entry?.payload ?? {}) as BudgetBarDatum;
            return [`${Math.round(row.pct * 100)}% · ${row.status}`, "Spent"];
          }}
        />
        <Bar dataKey="plotted" name="Spent" radius={[0, 4, 4, 0]} isAnimationActive={animate}>
          {plotted.map((row) => (
            <Cell key={row.id} fill={budgetBarFill(row.status)} />
          ))}
          <LabelList dataKey="pct" position="right" formatter={(label) => budgetBarLabel(Number(label ?? 0))} />
        </Bar>
      </BarChart>
      <ul className="sr-only">
        {data.map((row) => (
          <li key={row.id}>
            {row.label}: {Math.round(row.pct * 100)} por ciento, estado {row.status}
          </li>
        ))}
      </ul>
    </div>
  );
}
