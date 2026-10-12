"use client";

import { useCallback, useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import DeckCard, { DeckEmptyState } from "@/components/dashboard/DeckCard";
import { SectionError, SectionSkeleton } from "@/components/dashboard/SectionStates";
import { VerifiedIcon } from "@/components/dashboard/icons";
import { deck } from "@/components/ui/deckStyles";
import { apiGet } from "@/lib/api/client";
import { useHabitsToday, type HabitTodayWire } from "@/lib/api/dashboard";
import type { HabitLogWire } from "@/lib/api/productivity";
import { todayInBogota } from "@/lib/finance/finance";
import { t, type EsKey } from "@/lib/i18n";

/** Streak heat of the prototype: cold at 0, warm at 1-2 days, hot from 3. */
export function streakPillClass(streak: number): string {
  const heat = streak >= 3 ? deck.streakPillHot : streak >= 1 ? deck.streakPillWarm : deck.streakPillCold;
  return `${deck.streakPill} ${heat}`;
}

const STATUS_KEY: Record<string, EsKey> = {
  done: "dashboard.habitStatusDone",
  pending: "dashboard.habitStatusPending",
  skipped: "dashboard.habitStatusSkipped",
};

/** Row status while the Bogotá day's logs have not answered (or failed): the
 * row says the state is unregistered instead of claiming `pending`. */
const UNKNOWN_STATUS = "unknown";

/** Weekday of a `YYYY-MM-DD` calendar day (0 = Sunday, the Postgres
 * `EXTRACT(DOW)` convention used by the backend mask and by
 * `habitDashboard.isExpected`). */
function dowOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/** Same mask convention as `habitDashboard.isExpected`: empty mask = every day. */
function scheduledOn(row: HabitTodayWire, day: string): boolean {
  const mask = row.days_of_week ?? [];
  return mask.length === 0 || mask.includes(dowOf(day));
}

/**
 * Real state of a `GET /habits/today` row on the Bogotá business day.
 *
 * The endpoint anchors `today_status` to the database's UTC `CURRENT_DATE`
 * (`backend/src/routes/habits.rs`): between 19:00 and midnight Bogotá that is
 * already the next day, so every habit reads `pending` on a day whose real log
 * says `done`. The day's own log is the authority and only a missing log falls
 * back to the schedule (`pending` when the Bogotá day expects the habit,
 * `skipped` when it does not) — never a fake `done`. Exported for the boundary
 * regression test.
 */
export function statusOnBogotaDay(
  row: HabitTodayWire,
  day: string,
  logs: HabitLogWire[],
): string {
  const log = logs.find((entry) => entry.habit_id === row.habit_id && entry.log_date === day);
  if (log) return log.status;
  return scheduledOn(row, day) ? "pending" : "skipped";
}

/** The day's log read: the answer, plus the two non-answers kept apart. */
interface DayLogsState {
  day: string;
  data?: HabitLogWire[];
  failed?: boolean;
}

/**
 * The card's own read of the Bogotá day's logs.
 *
 * The shared `useHabitDayLogs` (lib/api/dashboard.ts) collapses "still
 * unanswered" and "failed" into the same `undefined`, and this card must tell
 * them apart: a failed read rendered as "unregistered" claims a state the data
 * does not support, and it must be retryable. Same day-scoped semantics as the
 * shared hook (a new day drops the previous day's logs before the request
 * answers) plus the failure flag and a `reload()` that re-issues the request.
 * Kept local to the card because `lib/api/dashboard.ts` is outside this fix's
 * edit surfaces.
 */
function useDayLogs(day: string) {
  const [state, setState] = useState<DayLogsState>({ day });
  const [reloadNonce, setReloadNonce] = useState(0);
  useEffect(() => {
    let active = true;
    // A new day (or a retry) drops the previous answer before the request lands.
    setState({ day });
    apiGet<HabitLogWire[]>(
      `/habits/logs?from=${encodeURIComponent(day)}&to=${encodeURIComponent(day)}`,
    )
      .then((data) => {
        if (active) setState({ day, data });
      })
      .catch(() => {
        if (active) setState({ day, failed: true });
      });
    return () => {
      active = false;
    };
  }, [day, reloadNonce]);
  const reload = useCallback(() => setReloadNonce((nonce) => nonce + 1), []);
  const answered = state.day === day;
  return { data: answered ? state.data : undefined, failed: answered && state.failed === true, reload };
}

/**
 * «Hoy»: the real habits returned by `GET /habits/today`, one prototype
 * checkbox row each with its streak pill. The card lists every habit of the
 * day with its real checkbox state, so the badge states the registered/total
 * count of the habits the day actually schedules instead of calling done
 * habits pending or counting an unscheduled one as due. The read is read-only
 * (the app has no toggle on this widget), so the checkbox mirrors the day's
 * real state and the accessible name states it instead of faking an
 * interaction.
 *
 * `today_status` alone cannot answer "today" at the UTC boundary, so the card
 * also reads the logs of its own Bogotá business day (`todayInBogota()`, the
 * convention the rest of the app derives the business day with, including the
 * user's `/dashboard/habitos/` grid) and lets them decide the checkbox. Until
 * that read answers, rows show the unknown state and the badge claims no
 * count; when it fails the card says so and offers a retry that re-runs it
 * (an unanswered read is never rendered as "not done" and never left without a
 * way to recover). A user with no habits gets the real empty state, never a
 * claim that everything is already registered.
 */
export default function TodayHabits({ className }: { className?: string }) {
  const habits = useHabitsToday();
  const day = todayInBogota();
  const { data: logs, failed: logsFailed, reload: reloadLogs } = useDayLogs(day);
  const { mutate } = useSWRConfig();
  const rows = habits.data ?? [];
  const dayRows = rows.map((row) => ({
    ...row,
    today_status: logs === undefined ? UNKNOWN_STATUS : statusOnBogotaDay(row, day, logs),
  }));
  // Only the habits the day schedules belong in the denominator: an unscheduled
  // habit is not "0 of N due today".
  const expected = dayRows.filter((habit) => habit.today_status !== "skipped");
  const registered = expected.filter((habit) => habit.today_status === "done").length;

  return (
    <DeckCard
      title={t("dashboard.today")}
      hint={t("dashboard.todayHint")}
      className={className}
      meta={
        logs === undefined || expected.length === 0 ? null : (
          <span className={deck.countPill}>
            {t("dashboard.todayRegisteredChip", { n: registered, total: expected.length })}
          </span>
        )
      }
    >
      {habits.isLoading ? (
        <SectionSkeleton label={t("common.loading")} />
      ) : habits.error ? (
        <SectionError
          onRetry={() =>
            void mutate((key) => typeof key === "string" && key.startsWith("dashboard/"))
          }
        />
      ) : dayRows.length === 0 ? (
        <DeckEmptyState
          icon={<VerifiedIcon className="h-5 w-5" />}
          title={t("dashboard.noHabitsYet")}
          hint={t("dashboard.noHabitsYetHint")}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {logsFailed ? (
            <SectionError message={t("dashboard.todayLogsFailed")} onRetry={reloadLogs} />
          ) : null}
          <ul className="flex flex-col gap-2.5">
            {dayRows.map((habit) => {
              const done = habit.today_status === "done";
              return (
                <li
                  key={habit.habit_id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-hair bg-panel p-3 transition-colors hover:border-slate-700"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={done}
                      readOnly
                      disabled
                      aria-label={t("dashboard.habitStatusLabel", {
                        name: habit.name,
                        status: t(STATUS_KEY[habit.today_status] ?? "dashboard.habitStatusOther"),
                      })}
                      className="h-4 w-4 shrink-0 rounded border-hair bg-card text-sky-500 focus:ring-0 focus:ring-offset-0"
                    />
                    <span className="truncate text-sm font-medium text-slate-200">{habit.name}</span>
                  </div>
                  <span className={streakPillClass(habit.current_streak)}>
                    <span>{t("dashboard.habitStreak", { n: habit.current_streak })}</span>
                    {habit.current_streak > 0 ? (
                      <span aria-hidden="true">
                        {"🔥".repeat(Math.min(habit.current_streak, 3))}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </DeckCard>
  );
}
