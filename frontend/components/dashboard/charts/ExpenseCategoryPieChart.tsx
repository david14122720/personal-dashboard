"use client";

import { Cell, Legend, Pie, PieChart, Tooltip } from "recharts";
import { t } from "@/lib/i18n";
import {
  categoryPieToken,
  chartTick,
  chartTok,
  chartTooltipStyle,
} from "@/components/ui/chartTheme";
import { useContainerWidth } from "@/components/ui/useContainerWidth";
import EmptyState from "@/components/ui/EmptyState";
import { formatMoney } from "@/lib/api/money";
import type { ExpenseCategorySlice } from "@/lib/finance/finance";

/**
 * True expense-by-category pie (no `innerRadius`, no donut). Pure
 * presentational: the section hands slices already aggregated by
 * `toExpenseByCategory`, largest first, so the legend order matches the data.
 * Every slice fill comes from `CATEGORY_PIE_TOKENS` via `chartTok`, the
 * tooltip formats Spanish money, and the chart is exposed as `role="img"`
 * with a typed Spanish label.
 */
export default function ExpenseCategoryPieChart({
  data,
  locale,
  currency,
  ariaLabel,
  animate = true,
}: {
  data: ExpenseCategorySlice[];
  locale: string;
  currency: string;
  ariaLabel?: string;
  animate?: boolean;
}) {
  const { ref: chartRef, width } = useContainerWidth(360);
  if (!data || data.length === 0) {
    return <EmptyState title={t("dashboard.expensePieEmpty", { currency })} />;
  }
  return (
    <div
      ref={chartRef}
      className="w-full overflow-x-auto rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
      tabIndex={0}
      role="img"
      aria-label={ariaLabel ?? t("dashboard.expensePieChartLabel")}
    >
      <PieChart width={width} height={260}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={90}
          // Skip the sweep when there is a single slice: it spans the full circle,
          // and Recharts' animation emits no sector while interpolating, leaving the
          // chart blank until the animation ends.
          isAnimationActive={animate && data.length > 1}
        >
          {data.map((slice, index) => (
            <Cell key={slice.categoryId} fill={chartTok(categoryPieToken(index))} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={chartTooltipStyle()}
          formatter={(value) => formatMoney(Number(value), { locale, currency })}
        />
        {/* 260px tall and a 90px radius need 180px, so a wrapping legend is
            capped at three rows: it wraps (12px, never below 11px) and scrolls
            instead of eating the plot area on a 300px phone. */}
        <Legend wrapperStyle={{ ...chartTick(), maxHeight: 64, overflowY: "auto" }} />
      </PieChart>
    </div>
  );
}
