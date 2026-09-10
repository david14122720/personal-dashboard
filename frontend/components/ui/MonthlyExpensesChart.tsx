"use client";

import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/api/money";
import { formatMonth, t } from "@/lib/i18n";
import { chartTick, chartTok, chartTooltipStyle } from "@/components/ui/chartTheme";
import EmptyState from "@/components/ui/EmptyState";

export interface ExpensePoint {
  month: string;
  expense: number;
}

/**
 * Gastos mensuales (columna `expense` de monthly-flow). Barras con tokens,
 * EmptyState i18n, reduced-motion vía `animate`, foco teclado.
 */
export default function MonthlyExpensesChart({
  data,
  animate = true,
}: {
  data: ExpensePoint[];
  animate?: boolean;
}) {
  if (!data || data.length === 0) {
    return <EmptyState title={t("charts.emptyExpenses")} hint={t("charts.emptyExpensesHint")} />;
  }
  const tok = chartTok;
  return (
    <div
      className="w-full overflow-x-auto rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
      tabIndex={0}
      role="img"
      aria-label={t("charts.monthlyExpenses")}
    >
      <BarChart
        width={560}
        height={260}
        data={data}
        accessibilityLayer
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      >
        <CartesianGrid stroke={tok("--color-hull")} strokeDasharray="3 3" />
        <XAxis dataKey="month" tickFormatter={(value: string) => formatMonth(value)} tick={chartTick()} tickLine={false} axisLine={{ stroke: tok("--color-hull") }} />
        <YAxis tick={chartTick()} tickLine={false} axisLine={false} width={64} />
        <Tooltip
          contentStyle={chartTooltipStyle()}
          formatter={(value, name) => [formatMoney(typeof value === "number" ? value : 0), name]}
        />
        <Bar
          dataKey="expense"
          name={t("charts.monthlyExpenses")}
          fill={tok("--color-signal")}
          radius={[4, 4, 0, 0]}
          isAnimationActive={animate}
        />
      </BarChart>
    </div>
  );
}
