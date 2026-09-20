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
import { SectionShell } from "@/components/productivity/ProductivitySections";

export interface TrackerHabit {
  habit_id: string;
  name: string;
  days_of_week?: number[] | null;
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
export function monthRangeDays(monthKey: string): string[] {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
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

/**
 * Month-grid habit tracker (`#rastreador-habitos`). Rows come from
 * `GET /habits/today` (passed in by the container), columns are the days of
 * the current month, and each cell reuses the shared calendar transforms and
 * palette. The past is read-only; only today's column logs via
 * `logHabitToday` (POST with 409 -> PATCH fallback).
 */
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
          className="inline-grid min-w-full gap-1"
          style={{ gridTemplateColumns: `minmax(8rem, 1fr) repeat(${days.length}, 1.75rem)` }}
        >
          <div role="row" className="contents">
            <span role="columnheader" aria-label={title} className="sticky left-0 min-w-32 px-1" />
            {days.map((date) => (
              <span
                key={date}
                role="columnheader"
                aria-label={t("productivity.tracker.dayColumn", { date })}
                title={date}
                className={`flex h-6 w-7 items-center justify-center font-mono text-[10px] tabular-nums ${
                  date === today ? "text-signal" : "text-instrument/50"
                }`}
              >
                {Number(date.slice(8))}
              </span>
            ))}
          </div>
          {rows.map(({ habit, stateByDate, stats }) => (
            <div key={habit.habit_id} role="row" aria-label={habit.name} className="contents">
              <span role="rowheader" className="sticky left-0 min-w-32 px-1">
                <span className="block truncate text-xs font-medium">{habit.name}</span>
                <span
                  aria-label={t("productivity.tracker.complianceLabel", {
                    name: habit.name,
                    n: stats.complianceRate,
                  })}
                  className="block font-mono text-[10px] tabular-nums text-instrument/50"
                >
                  {`${stats.complianceRate}%`}
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
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div id="rastreador-habitos" className="scroll-mt-4">
      <SectionShell title={title} hint={t("productivity.tracker.hint")} span="">
        {logError ? (
          <p role="alert" className="mb-3 rounded-lg border border-alert/50 bg-alert/10 p-3 text-sm">
            {logError}
          </p>
        ) : null}
        {body}
      </SectionShell>
    </div>
  );
}
