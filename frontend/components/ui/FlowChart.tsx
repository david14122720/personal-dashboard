"use client";

import { Area, AreaChart, CartesianGrid, LabelList, Tooltip, XAxis, YAxis } from "recharts";
import type { FlowPoint } from "@/lib/dashboard/transforms";
import { formatMoney } from "@/lib/api/money";
import { chartToken, formatMonth } from "@/lib/i18n";
import EmptyState from "@/components/ui/EmptyState";

/**
 * Monthly income-vs-expense area chart. Renders the shared EmptyState
 * (no error) when the aggregate response has no data points.
 */
export default function FlowChart({ data, animate = true }: { data: FlowPoint[]; animate?: boolean }) {
  if (!data || data.length === 0) {
    return <EmptyState title="No flow data yet" hint="Add transactions to plot income versus expense." />;
  }
  const tok = (prop: `--color-${string}`): string => chartToken(prop) || `var(${prop})`;
  const income = tok("--color-flow");
  const expense = tok("--color-signal");
  return (
    <div className="w-full overflow-x-auto">
      <AreaChart
        width={560}
        height={260}
        data={data}
        accessibilityLayer
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      >
        <CartesianGrid stroke={tok("--color-hull")} strokeDasharray="3 3" />
        <XAxis dataKey="month" tickFormatter={(value: string) => formatMonth(value)} tick={{ fill: tok("--color-instrument"), fontSize: 12 }} tickLine={false} axisLine={{ stroke: tok("--color-hull") }} />
        <YAxis tick={{ fill: tok("--color-instrument"), fontSize: 12 }} tickLine={false} axisLine={false} width={64} />
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
        <Area
          type="monotone"
          dataKey="income"
          name="Income"
          stroke={income}
          fill={income}
          fillOpacity={0.25}
          strokeWidth={2}
          isAnimationActive={animate}
        >
          <LabelList dataKey="income" position="top" formatter={(label) => formatMoney(typeof label === "number" ? label : 0)} />
        </Area>
        <Area
          type="monotone"
          dataKey="expense"
          name="Expense"
          stroke={expense}
          fill={expense}
          fillOpacity={0.2}
          strokeWidth={2}
          isAnimationActive={animate}
        >
          <LabelList dataKey="expense" position="top" formatter={(label) => formatMoney(typeof label === "number" ? label : 0)} />
        </Area>
      </AreaChart>
    </div>
  );
}
