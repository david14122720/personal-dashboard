"use client";

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/api/money";
import { formatMonth, t } from "@/lib/i18n";
import { chartTick, chartTok, chartTooltipStyle } from "@/components/ui/chartTheme";
import EmptyState from "@/components/ui/EmptyState";

export interface BalancePoint {
  month: string;
  balance: number;
}

/**
 * Evolución del saldo acumulado desde `toBalanceSeries(monthly-flow)`.
 * Patrón FlowChart: tokens, EmptyState i18n, reduced-motion vía `animate`,
 * foco teclado, 560×260 con scroll horizontal, sin `window` en import.
 */
export default function BalanceChart({ data, animate = true }: { data: BalancePoint[]; animate?: boolean }) {
  if (!data || data.length === 0) {
    return <EmptyState title={t("charts.emptyBalance")} hint={t("charts.emptyBalanceHint")} />;
  }
  const tok = chartTok;
  const line = tok("--color-flow");
  return (
    <div
      className="w-full overflow-x-auto rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
      tabIndex={0}
      role="img"
      aria-label={t("charts.balance")}
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
        <Area
          type="monotone"
          dataKey="balance"
          name={t("charts.balance")}
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
