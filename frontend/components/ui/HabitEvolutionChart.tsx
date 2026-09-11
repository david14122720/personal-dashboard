"use client";

import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { t } from "@/lib/i18n";
import { chartTick, chartTok, chartTooltipStyle, EVOLUTION_SERIES_TOKENS } from "@/components/ui/chartTheme";
import EmptyState from "@/components/ui/EmptyState";

export interface EvolutionRow { bucket: string; [series: string]: string | number; }

/**
 * Multi-series habit evolution (done-counts per bucket, one Line per habit
 * labelled by name, max 4). Pure presentational; the section merges
 * `aggregateEvolution` series into rows before rendering.
 */
export default function HabitEvolutionChart({
  data,
  series,
  animate = true,
}: {
  data: EvolutionRow[];
  series: string[];
  animate?: boolean;
}) {
  if (!data || data.length === 0 || series.length === 0) {
    return <EmptyState title={t("productivity.evolution.empty")} hint={t("productivity.evolution.emptyHint")} />;
  }
  return (
    <div
      className="w-full overflow-x-auto rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
      tabIndex={0}
      role="img"
      aria-label={t("productivity.evolution.title")}
    >
      <LineChart
        width={560}
        height={260}
        data={data}
        accessibilityLayer
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      >
        <CartesianGrid stroke={chartTok("--color-hull")} strokeDasharray="3 3" />
        <XAxis dataKey="bucket" tick={chartTick()} tickLine={false} axisLine={{ stroke: chartTok("--color-hull") }} />
        <YAxis tick={chartTick()} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <Tooltip contentStyle={chartTooltipStyle()} />
        {series.map((name, index) => (
          <Line
            key={name}
            type="monotone"
            dataKey={name}
            name={name}
            stroke={chartTok(EVOLUTION_SERIES_TOKENS[index % EVOLUTION_SERIES_TOKENS.length])}
            strokeWidth={2}
            dot={false}
            isAnimationActive={animate}
          />
        ))}
      </LineChart>
    </div>
  );
}
