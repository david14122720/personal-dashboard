"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import EmptyState from "@/components/ui/EmptyState";
import HabitsHeatmap from "@/components/ui/HabitsHeatmap";
import { t } from "@/lib/i18n";
import { habitsHistoryKey, useHabitsHistory } from "@/lib/api/productivity";
import { usePrefersReducedMotion } from "@/lib/dashboard/useReducedMotion";
import {
  aggregateEvolution,
  calendarStateToHeat,
  habitStats,
  logsToCalendarCells,
  type CalendarState,
  type EvolutionGranularity,
} from "@/lib/productivity/habitStats";
import { todayYmdLocal } from "@/lib/productivity/productivity";
import { EVOLUTION_SERIES_TOKENS } from "@/components/ui/chartTheme";
import type { EvolutionRow } from "@/components/ui/HabitEvolutionChart";

const HabitEvolutionChart = dynamic(() => import("@/components/ui/HabitEvolutionChart"), {
  ssr: false,
  loading: () => <p role="status" className="text-sm text-instrument/60">{t("common.loading")}</p>,
});

export interface HistoryHabit { habit_id: string; name: string; days_of_week?: number[]; current_streak?: number | null; }

const COMPARE_MAX = 4;
const CELLS_PER_ROW = 7;

/** Mes `YYYY-MM` del reloj local (UTC daría el mes equivocado en husos negativos). */
export function defaultMonthKey(now: Date = new Date()): string {
  return todayYmdLocal(now).slice(0, 7);
}

const stateClass: Record<CalendarState, string> = {
  "cumplido": "bg-flow",
  "no-cumplido": "bg-alert",
  "omitido": "bg-hull",
  "sin-registro": "bg-signal/30",
};

function stateText(state: CalendarState): string {
  if (state === "cumplido") return t("productivity.habitStatusDone");
  if (state === "no-cumplido") return t("productivity.habitStatusMissed");
  if (state === "omitido") return t("productivity.habitStatusSkipped");
  return t("productivity.habitStatusPending");
}

function monthRange(monthKey: string): { from: string; to: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { from: `${monthKey}-01`, to: last };
}

/** Merge per-habit bucketed series into Recharts rows keyed by bucket. */
export function toEvolutionRows(
  logs: Array<{ habit_id: string; log_date: string; status: string }>,
  picked: HistoryHabit[],
  granularity: EvolutionGranularity,
): { rows: EvolutionRow[]; series: string[] } {
  const series = aggregateEvolution(
    logs,
    picked.map((h) => ({ id: h.habit_id, name: h.name })),
    granularity,
  );
  const buckets = [...new Set(series.flatMap((s) => s.points.map((p) => p.bucket)))].sort();
  const byName = new Map(series.map((s) => [s.name, new Map(s.points.map((p) => [p.bucket, p.done]))]));
  const rows = buckets.map((bucket) => ({
    bucket,
    ...Object.fromEntries(series.map((s) => [s.name, byName.get(s.name)?.get(bucket) ?? 0])),
  }));
  return { rows, series: series.map((s) => s.name) };
}

/** Habit history for `#calendario-habitos`: name-only selector, 42-cell real-log calendar, base stats, S/M/A evolution, max-4 compare. */
export default function HabitHistorySection({
  habits,
  monthKey,
  now,
}: {
  habits: HistoryHabit[];
  monthKey?: string;
  now?: Date;
}) {
  const { mutate } = useSWRConfig();
  const reduced = usePrefersReducedMotion();
  const [selectedId, setSelectedId] = useState(habits[0]?.habit_id ?? "");
  const [granularity, setGranularity] = useState<EvolutionGranularity>("month");
  const [compareIds, setCompareIds] = useState<string[]>(habits[0] ? [habits[0].habit_id] : []);
  const seeded = useRef(false);
  const month = monthKey ?? defaultMonthKey(now);

  // El primer render ve `habits=[]` (SWR aún sin resolver) y el estado inicial queda
  // vacío; al llegar los hábitos hay que sembrar selección y comparador una sola vez.
  useEffect(() => {
    const first = habits[0];
    if (seeded.current || !first) return;
    seeded.current = true;
    setSelectedId((current) => current || first.habit_id);
    setCompareIds((current) => (current.length > 0 ? current : [first.habit_id]));
  }, [habits]);

  const { from, to } = useMemo(() => monthRange(month), [month]);
  const history = useHabitsHistory(from, to);
  const logs = useMemo(() => history.data ?? [], [history.data]);

  const selected = habits.find((h) => h.habit_id === selectedId) ?? habits[0];
  const cells = useMemo(
    () => (selected ? logsToCalendarCells(logs, selected.habit_id, month) : []),
    [logs, selected, month],
  );
  const rows = useMemo(
    () => Array.from({ length: cells.length / CELLS_PER_ROW }, (_, row) => cells.slice(row * CELLS_PER_ROW, (row + 1) * CELLS_PER_ROW)),
    [cells],
  );
  const stats = useMemo(
    () => habitStats(logs.filter((l) => l.habit_id === selected?.habit_id), from, to, selected?.days_of_week),
    [logs, selected, from, to],
  );
  const heats = useMemo(() => cells.map((c) => calendarStateToHeat(c.state)), [cells]);
  // Racha actual del API (`GET /habits/today`); la del mes solo como fallback.
  const currentStreak = selected?.current_streak ?? stats.currentStreak;
  const picked = useMemo(() => habits.filter((h) => compareIds.includes(h.habit_id)).slice(0, COMPARE_MAX), [habits, compareIds]);
  const evolution = useMemo(() => toEvolutionRows(logs, picked, granularity), [logs, picked, granularity]);

  function toggleCompare(habitId: string): void {
    setCompareIds((prev) =>
      prev.includes(habitId) ? prev.filter((id) => id !== habitId) : prev.length >= COMPARE_MAX ? prev : [...prev, habitId],
    );
  }

  if (history.error) {
    return (
      <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-5">
        <h3 className="font-display text-base font-semibold">{t("productivity.history.loadFailed")}</h3>
        <button
          type="button"
          onClick={() => void mutate(habitsHistoryKey(from, to))}
          className="mt-3 rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }
  if (history.isLoading) {
    return <p role="status" aria-busy="true" className="text-sm text-instrument/60">{t("common.loading")}</p>;
  }
  if (!selected) {
    return <EmptyState title={t("productivity.noHabits")} hint={t("productivity.noHabitsHint")} />;
  }
  return (
    <section aria-label={t("productivity.history.title")} className="flex flex-col gap-4">
      <label className="block max-w-xs">
        <span className="font-display text-xs font-semibold uppercase tracking-widest text-instrument/50">
          {t("productivity.history.selectHabit")}
        </span>
        <select
          aria-label={t("productivity.history.selectHabit")}
          value={selected.habit_id}
          onChange={(event) => setSelectedId(event.target.value)}
          className="mt-1 w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm focus:border-signal focus:outline-none"
        >
          {habits.map((habit) => (
            <option key={habit.habit_id} value={habit.habit_id}>{habit.name}</option>
          ))}
        </select>
      </label>
      {logs.length === 0 ? (
        <EmptyState title={t("productivity.history.empty")} hint={t("productivity.history.emptyHint")} />
      ) : (
        <>
          <div
            role="grid"
            aria-label={selected.name}
            tabIndex={0}
            className="grid grid-cols-7 gap-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            {rows.map((row, rowIndex) => (
              <div key={`row-${rowIndex}`} role="row" className="contents">
                {row.map((cell) => (
                  <span
                    key={cell.date}
                    role="gridcell"
                    title={`${cell.date}, ${stateText(cell.state)}`}
                    aria-label={`${cell.date}, ${stateText(cell.state)}`}
                    className={`flex h-8 items-center justify-center rounded-md font-mono text-[11px] tabular-nums ${stateClass[cell.state]}`}
                  >
                    {Number(cell.date.slice(8))}
                  </span>
                ))}
              </div>
            ))}
          </div>
          <HabitsHeatmap cells={heats} label={selected.name} dates={cells.map((c) => c.date)} />
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              [t("productivity.stats.bestStreak"), t("productivity.stats.daysUnit", { n: stats.bestStreak })],
              [t("productivity.stats.currentStreak"), t("productivity.stats.daysUnit", { n: currentStreak })],
              [t("productivity.stats.compliance"), `${stats.complianceRate}%`],
              [`${t("productivity.stats.done")} · ${t("productivity.stats.missed")} · ${t("productivity.stats.skipped")} · ${t("productivity.stats.unlogged")}`, `${stats.done} · ${stats.missed} · ${stats.skipped} · ${stats.unlogged}`],
            ].map(([term, value]) => (
              <div key={term} className="rounded-lg border border-hull px-3 py-2">
                <dt className="text-xs text-instrument/60">{term}</dt>
                <dd className="font-mono text-sm tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <div>
        <h3 className="font-display text-sm font-semibold">{t("productivity.evolution.title")}</h3>
        <div role="group" aria-label={t("productivity.evolution.title")} className="mt-2 flex flex-wrap gap-2">
          {(["week", "month", "year"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={granularity === value}
              onClick={() => setGranularity(value)}
              className={`rounded-full border px-3 py-1 font-display text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal ${granularity === value ? "border-signal text-signal" : "border-hull hover:border-signal hover:text-signal"}`}
            >
              {t(`productivity.evolution.${value}`)}
            </button>
          ))}
        </div>
        <HabitEvolutionChart data={evolution.rows} series={evolution.series} animate={!reduced} />
        {evolution.series.length > 0 ? (
          <ul aria-label={t("productivity.compare.title")} className="mt-2 flex flex-wrap gap-3">
            {evolution.series.map((name, index) => (
              <li key={name} className="flex items-center gap-1.5 text-xs text-instrument/70">
                <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: `var(${EVOLUTION_SERIES_TOKENS[index % EVOLUTION_SERIES_TOKENS.length]})` }} />
                {name}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div>
        <h3 className="font-display text-sm font-semibold">{t("productivity.compare.title")}</h3>
        <p className="mt-1 text-xs text-instrument/60">{t("productivity.compare.hint", { max: COMPARE_MAX })}</p>
        {compareIds.length >= COMPARE_MAX ? (
          <p className="mt-1 text-xs text-signal">{t("productivity.compare.maxReached", { max: COMPARE_MAX })}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          {habits.map((habit) => (
            <label key={habit.habit_id} className="flex cursor-pointer items-center gap-1.5 rounded-full border border-hull px-3 py-1 text-xs has-checked:border-signal has-checked:text-signal">
              <input
                type="checkbox"
                checked={compareIds.includes(habit.habit_id)}
                disabled={!compareIds.includes(habit.habit_id) && compareIds.length >= COMPARE_MAX}
                onChange={() => toggleCompare(habit.habit_id)}
                className="accent-signal focus-visible:outline-none"
              />
              {habit.name}
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
