"use client";

import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/api/money";
import { toMonthCompare, type FlowLike } from "@/lib/finance/finance";
import { formatMonth, t } from "@/lib/i18n";
import { chartTick, chartTok, chartTooltipStyle } from "@/components/ui/chartTheme";
import EmptyState from "@/components/ui/EmptyState";

/**
 * Mes actual vs anterior (gasto) + delta % vía `toMonthCompare`.
 * <2 meses → EmptyState i18n. Mismo patrón/vales que los otros S6.
 */
export default function MonthCompareChart({
  data,
  animate = true,
}: {
  data: FlowLike[];
  animate?: boolean;
}) {
  const compare = toMonthCompare(data);
  if (!compare) {
    return <EmptyState title={t("charts.emptyCompare")} hint={t("charts.emptyCompareHint")} />;
  }
  const tok = chartTok;
  const pctText =
    compare.deltaPct === null
      ? "—"
      : `${compare.deltaPct >= 0 ? "+" : ""}${Math.round(compare.deltaPct * 100)}%`;
  const bars = [
    { month: compare.prevMonth, expense: compare.prev },
    { month: compare.curMonth, expense: compare.cur },
  ];
  return (
    <div
      className="w-full overflow-x-auto rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
      tabIndex={0}
      role="img"
      aria-label={t("charts.monthCompare")}
    >
      <p className="mb-2 font-mono text-xs tabular-nums text-instrument/70">
        {t("charts.deltaLabel", { pct: pctText })}
      </p>
      <BarChart
        width={560}
        height={260}
        data={bars}
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
