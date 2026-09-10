"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/api/money";
import { formatMonth, t } from "@/lib/i18n";
import { chartTick, chartTok, chartTooltipStyle } from "@/components/ui/chartTheme";
import EmptyState from "@/components/ui/EmptyState";

export interface SavingsPoint {
  month: string;
  savings: number;
}

/**
 * Ahorro mensual `income−expense` desde `toSavingsSeries`. Admite negativo
 * con eje en 0 (ReferenceLine). Mismo patrón/vales que BalanceChart.
 */
export default function SavingsChart({ data, animate = true }: { data: SavingsPoint[]; animate?: boolean }) {
  if (!data || data.length === 0) {
    return <EmptyState title={t("charts.emptySavings")} hint={t("charts.emptySavingsHint")} />;
  }
  const tok = chartTok;
  const line = tok("--color-flow");
  return (
    <div
      className="w-full overflow-x-auto rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
      tabIndex={0}
      role="img"
      aria-label={t("charts.savings")}
    >
      <AreaChart
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
        <ReferenceLine y={0} stroke={tok("--color-hull")} />
        <Area
          type="monotone"
          dataKey="savings"
          name={t("charts.savings")}
          stroke={line}
          fill={line}
          fillOpacity={0.25}
          strokeWidth={2}
          isAnimationActive={animate}
        />
      </AreaChart>
    </div>
  );
}
