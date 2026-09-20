"use client";

import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import EmptyState from "@/components/ui/EmptyState";
import { t } from "@/lib/i18n";
import {
  HABITS_TODAY_KEY,
  habitsHistoryKey,
  logHabitToday,
  useHabitsHistory,
  type HabitTodayWire,
} from "@/lib/api/productivity";
import { usePrefersReducedMotion } from "@/lib/dashboard/useReducedMotion";
import {
  calendarStateToHeat,
  habitStats,
  logsToCalendarCells,
  type CalendarState,
} from "@/lib/productivity/habitStats";
import { todayYmdLocal } from "@/lib/productivity/productivity";

export interface TrackerHabit {
  habit_id: string;
  name: string;
  days_of_week?: number[] | null;
}

const stateClass: Record<CalendarState, string> = {
  // Completed cells keep `bg-flow` and add a cyan glow close to the Stitch art.
  "cumplido": "bg-flow shadow-[0_0_12px_-2px_var(--color-signal)]",
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

/** Day-of-week for a `YYYY-MM-DD` date (0=Sun..6=Sat, same as backend EXTRACT(DOW)). */
function dowOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Empty mask means every day; otherwise only masked weekdays are scheduled. */
function isScheduled(daysOfWeek: number[] | null | undefined, date: string): boolean {
  if (!daysOfWeek || daysOfWeek.length === 0) return true;
  return daysOfWeek.includes(dowOf(date));
}

/** Every `YYYY-MM-DD` day of `monthKey` (`YYYY-MM`), sorted. Empty for bad keys. */
export function monthRangeDays(monthKey: string): string[] {  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return [];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days: string[] = [];
  for (let day = 1; day <= last; day += 1) {
    days.push(`${monthKey}-${String(day).padStart(2, "0")}`);
  }
  return days;
}

const DOW_SHORT_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** Human schedule from `days_of_week`; empty mask means every day. */
function frequencyText(daysOfWeek: number[] | null | undefined): string {
  if (!daysOfWeek || daysOfWeek.length === 0) return t("productivity.tracker.everyday");
  return [...daysOfWeek]
    .sort((a, b) => a - b)
    .map((day) => DOW_SHORT_ES[day] ?? String(day))
    .join(" · ");
}

/**
 * Month-grid habit tracker (`#rastreador-habitos`). Rows come from
 * `GET /habits/today` (passed in by the container), columns are the days of
 * the current month, and each cell reuses the shared calendar transforms and
 * palette. The past is read-only; only today's column logs via
 * `logHabitToday` (POST with 409 -> PATCH fallback).
 */
function PulseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M2.5 10h3.5l2-5 3.5 10 2-5h3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FlameIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M10 2.5c.8 3-1.5 4.3-1.5 6.5 0 1.4 1 2.5 2.2 2.5 2 0 2.8-2 2.3-3.7 1.9 1.3 3 3.4 3 5.2 0 3-2.5 5-5.5 5S5 15.9 5 13c0-3.5 3.5-5.5 5-10.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GridIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="3" y="3" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="3" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="11" width="6" height="6" rx="3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M7.5 10.2l1.8 1.8 3.2-3.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function HabitsTrackerGrid({
  habits,
  monthKey: monthKeyProp,
  todayYmd: todayProp,
  now,
}: {
  habits: Array<HabitTodayWire | TrackerHabit>;
  monthKey?: string;
  todayYmd?: string;
  now?: Date;
}) {
  const reduced = usePrefersReducedMotion();
  const { mutate } = useSWRConfig();
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  const today = todayProp ?? todayYmdLocal(now);
  const month = monthKeyProp ?? today.slice(0, 7);
  const days = useMemo(() => monthRangeDays(month), [month]);
  const from = days[0] ?? null;
  const to = days[days.length - 1] ?? null;

  const history = useHabitsHistory(from, to);
  const logs = useMemo(() => history.data ?? [], [history.data]);

  // Lookup by habit + date for today's pressed state.
  const logByHabitDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of logs) map.set(`${entry.habit_id}|${entry.log_date}`, entry.status);
    return map;
  }, [logs]);

  const rows = useMemo(
    () =>
      habits.map((habit) => {
        const monthCells = logsToCalendarCells(logs, habit.habit_id, month).filter((cell) =>
          cell.date.startsWith(month),
        );
        const stateByDate = new Map(monthCells.map((cell) => [cell.date, cell.state]));
        const stats = habitStats(
          logs.filter((entry) => entry.habit_id === habit.habit_id),
          from ?? month,
          to ?? month,
          habit.days_of_week ?? undefined,
        );
        return { habit, stateByDate, stats };
      }),
    [habits, logs, month, from, to],
  );

  // Monthly KPIs from real data only (no invented deltas):
  // - compliance = mean of per-habit complianceRate over scheduled days (habitStats);
  // - longest streak = max per-habit bestStreak;
  // - active = habit count;
  // - today = done-today / scheduled-today (today_status wire, history fallback).
  const kpis = useMemo(() => {
    const rates = rows.map(({ stats }) => stats.complianceRate);
    const compliance = rows.length === 0 ? 0 : Math.round((rates.reduce((a, b) => a + b, 0) / rows.length) * 10) / 10;
    let longestStreak = 0;
    for (const { stats } of rows) longestStreak = Math.max(longestStreak, stats.bestStreak);
    let doneToday = 0;
    let scheduledToday = 0;
    for (const habit of habits) {
      if (!isScheduled(habit.days_of_week, today)) continue;
      scheduledToday += 1;
      const status =
        "today_status" in habit && typeof habit.today_status === "string"
          ? habit.today_status
          : (logByHabitDate.get(`${habit.habit_id}|${today}`) ?? "");
      if (status === "done") doneToday += 1;
    }
    return { compliance, longestStreak, active: habits.length, doneToday, scheduledToday };
  }, [rows, habits, logByHabitDate, today]);

  async function handleMarkToday(habitId: string): Promise<void> {
    if (loggingId) return;
    setLoggingId(habitId);
    setLogError(null);
    try {
      await logHabitToday(habitId, "done", today);
      await mutate(habitsHistoryKey(from, to));
      await mutate(HABITS_TODAY_KEY);
    } catch {
      setLogError(t("productivity.tracker.logFailed"));
    } finally {
      setLoggingId(null);
    }
  }

  const motionClass = reduced ? "" : "transition-colors";
  const title = t("productivity.tracker.title");

  let body: React.ReactNode;
  if (history.error) {
    body = (
      <div role="alert" className="rounded-lg border border-alert/50 bg-alert/10 p-4">
        <p className="font-display text-sm font-semibold">{t("productivity.tracker.loadFailed")}</p>
        <button
          type="button"
          onClick={() => void mutate(habitsHistoryKey(from, to))}
          className="mt-3 rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  } else if (history.isLoading) {
    body = (
      <p role="status" aria-busy="true" className="text-sm text-instrument/60">
        {t("common.loading")}
      </p>
    );
  } else if (habits.length === 0) {
    body = <EmptyState title={t("productivity.tracker.empty")} hint={t("productivity.tracker.emptyHint")} />;
  } else {
    body = (
      <div className="overflow-x-auto">
        <div
          role="grid"
          aria-label={title}
          className="grid w-max min-w-full gap-1"
          style={{ gridTemplateColumns: `minmax(10rem, 1.4fr) repeat(${days.length}, 1.75rem) 3rem 3rem` }}
        >
          <div role="row" className="contents">
            <span role="columnheader" aria-label={t("productivity.tracker.colHabit")} className="sticky left-0 bg-deck px-2" />
            {days.map((date) => {
              const isTodayHeader = date === today;
              const isFutureHeader = date > today;
              return (
                <span
                  key={date}
                  role="columnheader"
                  aria-label={t("productivity.tracker.dayColumn", { date })}
                  aria-current={isTodayHeader ? "date" : undefined}
                  title={date}
                  className={`flex h-6 w-7 items-center justify-center font-mono text-[10px] tabular-nums ${
                    isTodayHeader ? "rounded bg-signal/15 text-signal" : "text-instrument/50"
                  } ${isFutureHeader ? "opacity-40" : ""}`}
                >
                  {Number(date.slice(8))}
                </span>
              );
            })}
            <span
              role="columnheader"
              title={t("productivity.tracker.colStreak")}
              className="flex items-center justify-center font-display text-[10px] uppercase tracking-wider text-instrument/50"
            >
              {t("productivity.tracker.colStreak")}
            </span>
            <span
              role="columnheader"
              title={t("productivity.tracker.colSuccess")}
              className="flex items-center justify-center font-display text-[10px] uppercase tracking-wider text-instrument/50"
            >
              {t("productivity.tracker.colSuccess")}
            </span>
          </div>
          {rows.map(({ habit, stateByDate, stats }) => (
            <div key={habit.habit_id} role="row" aria-label={habit.name} className="contents">
              <span role="rowheader" className="sticky left-0 min-w-40 bg-deck px-2">
                <span className="block truncate text-xs font-medium">{habit.name}</span>
                <span className="block truncate text-[10px] text-instrument/50">
                  {frequencyText(habit.days_of_week)}
                </span>
              </span>
              {days.map((date) => {
                const scheduled = isScheduled(habit.days_of_week, date);
                const state: CalendarState = scheduled
                  ? (stateByDate.get(date) ?? "sin-registro")
                  : "sin-registro";
                const heat = calendarStateToHeat(state);
                const isToday = date === today;
                const isFuture = date > today;
                const label = scheduled
                  ? t("productivity.tracker.dayLabel", {
                      name: habit.name,
                      date,
                      status: stateText(state),
                    })
                  : t("productivity.tracker.dayLabel", {
                      name: habit.name,
                      date,
                      status: t("productivity.tracker.unscheduled"),
                    });
                if (!scheduled) {
                  return (
                    <span
                      key={date}
                      role="gridcell"
                      aria-label={label}
                      data-heat={heat}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-hull/40"
                    />
                  );
                }
                if (isToday) {
                  const pressed = logByHabitDate.get(`${habit.habit_id}|${today}`) === "done";
                  return (
                    <button
                      key={date}
                      type="button"
                      role="gridcell"
                      aria-label={t("productivity.tracker.markToday", { name: habit.name })}
                      aria-pressed={pressed}
                      title={label}
                      data-heat={heat}
                      disabled={loggingId === habit.habit_id}
                      onClick={() => void handleMarkToday(habit.habit_id)}
                      className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-md font-mono text-[10px] tabular-nums ${stateClass[state]} ${motionClass} hover:ring-2 hover:ring-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:opacity-50`}
                    >
                      {Number(date.slice(8))}
                    </button>
                  );
                }
                return (
                  <span
                    key={date}
                    role="gridcell"
                    aria-label={label}
                    title={label}
                    data-heat={heat}
                    aria-disabled={isFuture ? "true" : undefined}
                    className={`flex h-7 w-7 items-center justify-center rounded-md font-mono text-[10px] tabular-nums ${stateClass[state]} ${isFuture ? "opacity-40" : ""}`}
                  >
                    {Number(date.slice(8))}
                  </span>
                );
              })}
              <span
                role="gridcell"
                aria-label={t("dashboard.habitStreak", { n: stats.bestStreak })}
                title={t("dashboard.habitStreak", { n: stats.bestStreak })}
                className="flex h-7 items-center justify-center font-mono text-[11px] tabular-nums text-instrument/80"
              >
                {stats.bestStreak}
              </span>
              <span
                role="gridcell"
                aria-label={t("productivity.tracker.complianceLabel", {
                  name: habit.name,
                  n: stats.complianceRate,
                })}
                title={t("productivity.tracker.complianceLabel", {
                  name: habit.name,
                  n: stats.complianceRate,
                })}
                className="flex h-7 items-center justify-center font-mono text-[11px] tabular-nums text-instrument/80"
              >
                {`${stats.complianceRate}%`}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // KPI cards + legend need settled month logs; loading/error/empty keep
  // their existing honest states instead of invented numbers.
  const showData = !history.error && !history.isLoading && habits.length > 0;
  const ringLength = 2 * Math.PI * 15.5;

  const kpiCardClass = "rounded-xl border border-hull bg-hull/40 p-4";
  const kpiLabelClass = "font-display text-[11px] uppercase tracking-widest text-instrument/50";

  return (
    <div id="rastreador-habitos" className="flex scroll-mt-4 flex-col gap-4">
      {logError ? (
        <p role="alert" className="rounded-lg border border-alert/50 bg-alert/10 p-3 text-sm">
          {logError}
        </p>
      ) : null}
      {showData ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div role="group" aria-label={t("productivity.tracker.kpiCompliance")} className={kpiCardClass}>
            <div className="flex items-center gap-2">
              <PulseIcon className="h-4 w-4 shrink-0 text-signal" />
              <p className={kpiLabelClass}>{t("productivity.tracker.kpiCompliance")}</p>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <svg
                width="48"
                height="48"
                viewBox="0 0 40 40"
                role="img"
                aria-label={t("productivity.tracker.complianceLabel", {
                  name: title,
                  n: kpis.compliance,
                })}
              >
                <circle cx="20" cy="20" r="15.5" fill="none" stroke="var(--color-hull)" strokeWidth="5" />
                <circle
                  cx="20"
                  cy="20"
                  r="15.5"
                  fill="none"
                  stroke="var(--color-signal)"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={ringLength.toFixed(1)}
                  strokeDashoffset={(ringLength * (1 - kpis.compliance / 100)).toFixed(1)}
                  transform="rotate(-90 20 20)"
                />
              </svg>
              <p className="font-display text-2xl font-semibold tabular-nums">{`${kpis.compliance}%`}</p>
            </div>
          </div>
          <div role="group" aria-label={t("productivity.tracker.kpiStreak")} className={kpiCardClass}>
            <div className="flex items-center gap-2">
              <FlameIcon className="h-4 w-4 shrink-0 text-signal" />
              <p className={kpiLabelClass}>{t("productivity.tracker.kpiStreak")}</p>
            </div>
            <p className="mt-2 font-display text-2xl font-semibold tabular-nums">{kpis.longestStreak}</p>
            <p className="mt-0.5 text-xs text-instrument/50">{t("productivity.tracker.streakUnit")}</p>
          </div>
          <div role="group" aria-label={t("productivity.tracker.kpiActive")} className={kpiCardClass}>
            <div className="flex items-center gap-2">
              <GridIcon className="h-4 w-4 shrink-0 text-signal" />
              <p className={kpiLabelClass}>{t("productivity.tracker.kpiActive")}</p>
            </div>
            <p className="mt-2 font-display text-2xl font-semibold tabular-nums">{kpis.active}</p>
          </div>
          <div role="group" aria-label={t("productivity.tracker.kpiToday")} className={kpiCardClass}>
            <div className="flex items-center gap-2">
              <CheckCircleIcon className="h-4 w-4 shrink-0 text-signal" />
              <p className={kpiLabelClass}>{t("productivity.tracker.kpiToday")}</p>
            </div>
            <p className="mt-2 font-display text-2xl font-semibold tabular-nums">
              {t("productivity.tracker.todayCount", { done: kpis.doneToday, total: kpis.scheduledToday })}
            </p>
          </div>
        </div>
      ) : null}
      {showData ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-instrument/60">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="bg-flow h-3 w-3 rounded shadow-[0_0_12px_-2px_var(--color-signal)]" />
            {t("productivity.tracker.legendDone")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="bg-signal/30 h-3 w-3 rounded" />
            {t("productivity.tracker.legendPending")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-3 w-3 rounded border border-hull/60 opacity-40" />
            {t("productivity.tracker.legendFuture")}
          </span>
          <span className="ml-auto rounded-full border border-signal/30 bg-signal/10 px-2.5 py-0.5 font-display text-[11px] uppercase tracking-widest text-signal">
            {t("productivity.tracker.todayPill", { n: Number(today.slice(8)) })}
          </span>
        </div>
      ) : null}
      {body}
    </div>
  );
}
