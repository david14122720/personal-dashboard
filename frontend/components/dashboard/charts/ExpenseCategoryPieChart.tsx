"use client";

import { Cell, Pie, PieChart, Tooltip } from "recharts";
import { t } from "@/lib/i18n";
import {
  categoryPieToken,
  chartTok,
  chartTooltipStyle,
} from "@/components/ui/chartTheme";
import { useContainerWidth } from "@/components/ui/useContainerWidth";
import EmptyState from "@/components/ui/EmptyState";
import { formatMoney } from "@/lib/api/money";
import type { ExpenseCategorySlice } from "@/lib/finance/finance";

/** Donut geometry from the prototype: the ring leaves a card-colored hole in
 * the middle where the real total is shown. */
const DONUT_INNER_RADIUS = 54;
const DONUT_OUTER_RADIUS = 90;

/**
 * Expense-by-category donut (prototype `chart-gastos-categoria`). Pure
 * presentational: the section hands slices already aggregated by
 * `toExpenseByCategory`, largest first, so the legend order matches the data.
 * Every slice fill comes from `CATEGORY_PIE_TOKENS` via `chartTok`, the tooltip
 * formats Spanish money, the hole shows the real total and the legend pills
 * carry the real percentages. The chart is exposed as `role="img"` with a
 * typed Spanish label.
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
  // Real total of the rendered slices: no prototype figure is reused (D10).
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  const percent = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return (
    <div
      ref={chartRef}
      className="w-full rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
      tabIndex={0}
      role="img"
      aria-label={ariaLabel ?? t("dashboard.expensePieChartLabel")}
    >
      <div className="relative">
        <PieChart width={width} height={260}>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={DONUT_INNER_RADIUS}
            outerRadius={DONUT_OUTER_RADIUS}
            // Skip the sweep when there is a single slice: it spans the full
            // ring, and Recharts' animation emits no sector while
            // interpolating, leaving the chart blank until the animation ends.
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
        </PieChart>
        {/* Card-colored hole: the ring is transparent inside, so the panel
            surface shows through and only the real total is written here. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
        >
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted">
            {t("dashboard.pieTotal")}
          </span>
          <span className="font-mono text-[11px] font-bold text-instrument">
            {formatMoney(total, { locale, currency })}
          </span>
        </div>
      </div>
      <ul className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs">
        {data.map((slice, index) => (
          <li
            key={slice.categoryId}
            className="flex items-center gap-2 rounded-lg border border-hair bg-panel px-3 py-1.5"
          >
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded"
              style={{ backgroundColor: chartTok(categoryPieToken(index)) }}
            />
            <span className="text-slate-300">{slice.name}:</span>
            <span
              className="font-mono font-semibold"
              style={{ color: chartTok(categoryPieToken(index)) }}
            >
              {formatMoney(slice.value, { locale, currency })}
            </span>
            <span className="font-mono text-[10px] text-slate-500">
              ({percent.format(total === 0 ? 0 : (slice.value / total) * 100)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
