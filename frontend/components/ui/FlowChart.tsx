"use client";

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import type { FlowPoint } from "@/lib/dashboard/transforms";
import EmptyState from "@/components/ui/EmptyState";

/**
 * Monthly income-vs-expense area chart. Renders the shared EmptyState
 * (no error) when the aggregate response has no data points.
 */
export default function FlowChart({ data, animate = true }: { data: FlowPoint[]; animate?: boolean }) {
  if (!data || data.length === 0) {
    return <EmptyState title="No flow data yet" hint="Add transactions to plot income versus expense." />;
  }
  return (
    <div className="w-full overflow-x-auto">
      <AreaChart
        width={560}
        height={260}
        data={data}
        accessibilityLayer
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      >
        <CartesianGrid stroke="#142433" strokeDasharray="3 3" />
        <XAxis dataKey="month" tick={{ fill: "#EAF1F7", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "#142433" }} />
        <YAxis tick={{ fill: "#EAF1F7", fontSize: 12 }} tickLine={false} axisLine={false} width={64} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#142433",
            border: "1px solid #142433",
            borderRadius: 8,
            color: "#EAF1F7",
            fontSize: 12,
          }}
        />
        <Area
          type="monotone"
          dataKey="income"
          name="Income"
          stroke="#2DD4A7"
          fill="#2DD4A7"
          fillOpacity={0.25}
          strokeWidth={2}
          isAnimationActive={animate}
        />
        <Area
          type="monotone"
          dataKey="expense"
          name="Expense"
          stroke="#56A8F5"
          fill="#56A8F5"
          fillOpacity={0.2}
          strokeWidth={2}
          isAnimationActive={animate}
        />
      </AreaChart>
    </div>
  );
}
