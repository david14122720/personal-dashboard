"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import EmptyState from "@/components/ui/EmptyState";
import HabitsHeatmap from "@/components/ui/HabitsHeatmap";
import { t } from "@/lib/i18n";
import { deck } from "@/components/ui/deckStyles";
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
  "cumplido": "bg-flow text-deck",
  "no-cumplido": "bg-alert text-deck",
  "omitido": "bg-hull text-slate-300",
  "sin-registro": "bg-signal/30 text-slate-200",
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

/** Tiny inline trend glyph for the evolution panel header (D3: no icon font). */
function TrendIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M3.5 13.5l4-4.2 3 2.6 5.5-6.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M13 5.5h3.5V9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
        <h3 className="text-sm font-semibold text-instrument">{t("productivity.history.loadFailed")}</h3>
        <button
          type="button"
          onClick={() => void mutate(habitsHistoryKey(from, to))}
          className={`${deck.headerAction} mt-3`}
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }
  if (history.isLoading) {
    return <p role="status" aria-busy="true" className="text-sm text-muted">{t("common.loading")}</p>;
  }
  if (!selected) {
    return <EmptyState title={t("productivity.noHabits")} hint={t("productivity.noHabitsHint")} />;
  }
  return (
    <section aria-label={t("productivity.history.title")} className="flex flex-col gap-4">
      <div className={deck.panel}>
        <div className={deck.sectionHeaderWrap}>
          <div className="flex items-center gap-2">
            <span className={deck.calendarIconTile}>
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="h-4 w-4">
                <rect x="3" y="4.5" width="14" height="12" rx="2" />
                <path d="M3 8h14M6.5 2.8v3M13.5 2.8v3" />
              </svg>
            </span>
            <div>
              <h2 className={deck.sectionTitle}>{t("productivity.history.title")}</h2>
              <p className={deck.sectionSubtitle}>{t("productivity.history.hint")}</p>
            </div>
          </div>
          <label className="block w-full max-w-xs">
            <span className={deck.filterLabel}>{t("productivity.history.selectHabit")}</span>
            <select
              aria-label={t("productivity.history.selectHabit")}
              value={selected.habit_id}
              onChange={(event) => setSelectedId(event.target.value)}
              className={deck.filterField}
            >
              {habits.map((habit) => (
                <option key={habit.habit_id} value={habit.habit_id}>{habit.name}</option>
              ))}
            </select>
          </label>
        </div>
        {logs.length === 0 ? (
          <EmptyState title={t("productivity.history.empty")} hint={t("productivity.history.emptyHint")} />
        ) : (
          <>
            <div
              role="grid"
              aria-label={selected.name}
              tabIndex={0}
              className="mt-4 grid grid-cols-7 gap-1 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            >
              {rows.map((row, rowIndex) => (
                <div key={`row-${rowIndex}`} role="row" className="contents">
                  {row.map((cell) => (
                    <span
                      key={cell.date}
                      role="gridcell"
                      title={`${cell.date}, ${stateText(cell.state)}`}
                      aria-label={`${cell.date}, ${stateText(cell.state)}`}
                      className={`${deck.historyCell} ${stateClass[cell.state]}`}
                    >
                      {Number(cell.date.slice(8))}
                    </span>
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-hair bg-panel/50 p-3">
              <HabitsHeatmap cells={heats} label={selected.name} dates={cells.map((c) => c.date)} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                [t("productivity.stats.bestStreak"), t("productivity.stats.daysUnit", { n: stats.bestStreak })],
                [t("productivity.stats.currentStreak"), t("productivity.stats.daysUnit", { n: currentStreak })],
                [t("productivity.stats.compliance"), `${stats.complianceRate}%`],
                [`${t("productivity.stats.done")} · ${t("productivity.stats.missed")} · ${t("productivity.stats.skipped")} · ${t("productivity.stats.unlogged")}`, `${stats.done} · ${stats.missed} · ${stats.skipped} · ${stats.unlogged}`],
              ].map(([term, value]) => (
                <div key={term} className={deck.statTile}>
                  <dt className="text-[11px] leading-snug text-faint">{term}</dt>
                  <dd className="mt-1 font-mono text-sm tabular-nums text-instrument">{value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
      <div className={deck.panel}>
        <div className={deck.sectionHeaderWrap}>
          <div className="flex items-center gap-2">
            <span className={deck.calendarIconTile}>
              <TrendIcon className="h-4 w-4" />
            </span>
            <div>
              <h3 className={deck.sectionTitle}>{t("productivity.evolution.title")}</h3>
            </div>
          </div>
          <div role="group" aria-label={t("productivity.evolution.title")} className="flex flex-wrap gap-2">
            {(["week", "month", "year"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={granularity === value}
                onClick={() => setGranularity(value)}
                className={granularity === value ? deck.cardPillActive : deck.cardPillIdle}
              >
                {t(`productivity.evolution.${value}`)}
              </button>
            ))}
          </div>
        </div>
        <HabitEvolutionChart data={evolution.rows} series={evolution.series} animate={!reduced} />
        {evolution.series.length > 0 ? (
          <ul aria-label={t("productivity.compare.title")} className="mt-3 flex flex-wrap gap-3">
            {evolution.series.map((name, index) => (
              <li key={name} className="flex items-center gap-1.5 text-xs text-muted">
                <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: `var(${EVOLUTION_SERIES_TOKENS[index % EVOLUTION_SERIES_TOKENS.length]})` }} />
                {name}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className={deck.panel}>
        <h3 className={deck.sectionTitle}>{t("productivity.compare.title")}</h3>
        <p className={deck.sectionSubtitle}>{t("productivity.compare.hint", { max: COMPARE_MAX })}</p>
        {compareIds.length >= COMPARE_MAX ? (
          <p className="mt-1 text-xs text-signal">{t("productivity.compare.maxReached", { max: COMPARE_MAX })}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {habits.map((habit) => (
            <label key={habit.habit_id} className={deck.compareChip}>
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
