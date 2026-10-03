"use client";

import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { t } from "@/lib/i18n";
import { chartTick, chartTok, chartTooltipStyle } from "@/components/ui/chartTheme";
import EmptyState from "@/components/ui/EmptyState";
import { formatMoney } from "@/lib/api/money";

export interface TrendRow {
  bucket: string;
  label: string;
  [series: string]: string | number;
}

export interface TrendSeries {
  key: string;
  label: string;
  token: `--color-${string}`;
  dashed?: boolean;
}

/**
 * Multi-series category trend (1..4 lines). Pure presentational: the section
 * hands rows already bucketed by `toCategoryTrend` and one descriptor per
 * line. Y ticks are compact (COP millions do not fit otherwise), the tooltip
 * shows full money, and every color comes from theme tokens.
 */
export default function CategoryTrendChart({
  data,
  series,
  locale,
  currency,
  ariaLabel,
  animate = true,
}: {
  data: TrendRow[];
  series: TrendSeries[];
  locale: string;
  currency: string;
  ariaLabel?: string;
  animate?: boolean;
}) {
  if (!data || data.length === 0 || series.length === 0) {
    return <EmptyState title={t("finance.chartEmpty")} hint={t("finance.chartEmptyHint")} />;
  }
  const compact = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  return (
    <div
      className="w-full overflow-x-auto rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
      tabIndex={0}
      role="img"
      aria-label={ariaLabel ?? t("finance.trendChartLabel")}
    >
      <LineChart
        width={560}
        height={260}
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      >
        <CartesianGrid stroke={chartTok("--color-hull")} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tick={chartTick()}
          tickLine={false}
          axisLine={{ stroke: chartTok("--color-hull") }}
        />
        <YAxis
          tick={chartTick()}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(value) => compact.format(Number(value))}
        />
        <Tooltip
          contentStyle={chartTooltipStyle()}
          formatter={(value) => formatMoney(Number(value), { locale, currency })}
        />
        <Legend wrapperStyle={chartTick()} />
        {series.map((line) => (
          <Line
            key={line.key}
            type="monotone"
            dataKey={line.key}
            name={line.label}
            stroke={chartTok(line.token)}
            strokeWidth={2}
            dot={false}
            strokeDasharray={line.dashed ? "5 3" : undefined}
            isAnimationActive={animate}
          />
        ))}
      </LineChart>
    </div>
  );
}
