"use client";

import { useEffect, useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { t, type EsKey } from "@/lib/i18n";
import {
  HABITS_LIST_KEY,
  HABITS_TODAY_KEY,
  archiveHabit,
  habitsHistoryKey,
  toggleHabitLog,
  useHabitsHistory,
  useHabitsList,
  type HabitLogWire,
  type HabitWire,
} from "@/lib/api/productivity";
import {
  MONTHLY_GOAL_PCT,
  activeHabits,
  categoriesCovered,
  complianceDelta,
  findMilestone,
  levelForXp,
  longestStreak,
  monthDays,
  monthlyCompliance,
  reflectionLine,
  todayCompletion,
  totalXp,
  weekdayConsistency,
  xpForLogs,
  type DashHabit,
  type DashLog,
} from "@/lib/productivity/habitDashboard";
import { habitStats } from "@/lib/productivity/habitStats";
import { todayYmdLocal } from "@/lib/productivity/productivity";
import HabitCreateModal from "./HabitCreateModal";
import HabitGrid, { type HabitGridRow } from "./HabitGrid";
import WeeklyChart, { type HabitReportRow } from "./WeeklyChart";

/** Shift a `YYYY-MM` key by `delta` months. Garbage in, garbage out. */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return monthKey;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

/** Every `YYYY-MM-DD` day of a month (sorted); empty for invalid keys. */
export function monthRangeDays(monthKey: string): string[] {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return [];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days: string[] = [];
  for (let day = 1; day <= last; day += 1) days.push(`${monthKey}-${String(day).padStart(2, "0")}`);
  return days;
}

function monthParts(monthKey: string): { name: string; year: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const raw = new Intl.DateTimeFormat("es", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(match[1]), month - 1, 1)));
  return { name: raw.charAt(0).toUpperCase() + raw.slice(1), year: match[1] };
}

/** Long Spanish month label via Intl, e.g. "Septiembre de 2026". */
export function monthLabel(monthKey: string): string {
  const parts = monthParts(monthKey);
  if (!parts) return monthKey;
  return `${parts.name} de ${parts.year}`;
}

function toDashHabit(wire: HabitWire): DashHabit {
  return {
    id: wire.id,
    name: wire.name,
    direction: wire.direction,
    frequency: wire.frequency,
    daysOfWeek: wire.days_of_week ?? [],
    startDate: wire.start_date,
    endDate: wire.end_date,
    category: wire.category,
    shortLabel: wire.short_label,
    isArchived: wire.is_archived,
  };
}

function toDashLog(log: HabitLogWire): DashLog {
  return { habitId: log.habit_id, date: log.log_date, status: log.status };
}

const WEEKDAY_SHORT_KEYS: EsKey[] = [
  "habitsDashboard.weekdaySun",
  "habitsDashboard.weekdayMon",
  "habitsDashboard.weekdayTue",
  "habitsDashboard.weekdayWed",
  "habitsDashboard.weekdayThu",
  "habitsDashboard.weekdayFri",
  "habitsDashboard.weekdaySat",
];

/** `Categoría • Detalle`; short label wins, frequency is the fallback detail. */
function subtitleFor(habit: DashHabit): string | null {
  const category = habit.category?.trim();
  let detail = habit.shortLabel?.trim() ?? "";
  if (!detail) {
    if (habit.frequency === "weekly") detail = t("habitsDashboard.freqWeekly");
    else if (habit.frequency === "monthly") detail = t("habitsDashboard.freqMonthly");
    else if (habit.frequency === "custom" && habit.daysOfWeek.length > 0) {
      detail = [...habit.daysOfWeek]
        .sort((a, b) => a - b)
        .map((day) => t(WEEKDAY_SHORT_KEYS[day] ?? "habitsDashboard.freqEveryday"))
        .join(" · ");
    } else detail = t("habitsDashboard.freqEveryday");
  }
  return category ? t("habitsDashboard.habitSubtitle", { category, detail }) : detail;
}

const KPI_CARD =
  "flex min-h-[176px] flex-col justify-between rounded-2xl border border-white/5 bg-gradient-to-b from-hull/40 to-deck/60 p-[22px]";
const CARD = "rounded-2xl border border-white/5 bg-gradient-to-b from-hull/40 to-deck/60 p-[22px]";
const KPI_LABEL = "font-display text-[11px] font-semibold uppercase tracking-widest text-instrument/60";

/** Dashboard-home habits cache (owned by `lib/api/dashboard.ts`). */
const DASHBOARD_HABITS_TODAY_KEY = "dashboard/habits-today";

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={className}>
      <rect x="3" y="4.5" width="14" height="12" rx="2" />
      <path d="M3 8h14M6.5 2.8v3M13.5 2.8v3" />
    </svg>
  );
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M12.5 5l-5.5 5 5.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M7.5 5l5.5 5-5.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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

function ListCheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M7.5 4.5h9M7.5 10h9M7.5 15.5h9M3.5 4.5l1 1 .5-2M3.5 10l1 1 .5-2M3.5 15.5l1 1 .5-2" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.5 10.2l1.8 1.8 3.2-3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShieldCheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 2.5l6 2.2v5c0 3.6-2.4 6.4-6 7.8-3.6-1.4-6-4.2-6-7.8v-5z" />
      <path d="M7.4 9.8l1.7 1.7 3.4-3.8" />
    </svg>
  );
}

function BulbIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 2.8a5 5 0 00-2.8 9.1c.5.4.8 1 .8 1.6v.7h4v-.7c0-.6.3-1.2.8-1.6A5 5 0 0010 2.8zM8 17h4M8.5 14.2h3" />
    </svg>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const radius = 26;
  const length = 2 * Math.PI * radius;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
      <circle cx="32" cy="32" r={radius} fill="none" stroke="var(--color-hull)" strokeWidth="6" />
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        stroke="var(--color-signal)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={length.toFixed(1)}
        strokeDashoffset={(length * (1 - clamped / 100)).toFixed(1)}
        transform="rotate(-90 32 32)"
      />
    </svg>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-2xl bg-hull/40 ${className ?? ""}`} />;
}

export interface HabitsDashboardProps {
  /** Test seam; defaults to the user's real local today. */
  todayYmd?: string;
}

/**
 * `/dashboard/habitos/` dashboard (spec §2): header + month navigator, 4 KPI
 * cards, category filters/legend, the month grid and the weekly/milestone/
 * reflection bottom row. Owns the visible-month state and the 12-month log
 * range so streaks and deltas have real history; every number comes from
 * `habitDashboard` helpers (no NaN/Infinity).
 */
export default function HabitsDashboard({ todayYmd }: HabitsDashboardProps) {
  const { mutate } = useSWRConfig();
  const today = todayYmd ?? todayYmdLocal();
  const currentMonth = today.slice(0, 7);
  const minMonth = shiftMonthKey(currentMonth, -11);
  const [visibleMonth, setVisibleMonth] = useState(currentMonth);
  const month = visibleMonth < minMonth ? minMonth : visibleMonth > currentMonth ? currentMonth : visibleMonth;

  const habits = useHabitsList();
  const rangeStart = `${shiftMonthKey(month, -11)}-01`;
  const monthEnd = monthRangeDays(month).slice(-1)[0] ?? `${month}-28`;
  // Keep today in range even when the visible month is in the past: the today
  // KPI, milestone, reflection and XP/level always read the same fetch.
  const rangeEnd = monthEnd > today ? monthEnd : today;
  const historyKey = habitsHistoryKey(rangeStart, rangeEnd);
  const history = useHabitsHistory(rangeStart, rangeEnd);

  const [filter, setFilter] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const wires = habits.data ?? [];
  const dashHabits = useMemo(() => wires.map(toDashHabit), [wires]);
  const dashLogs = useMemo(() => (history.data ?? []).map(toDashLog), [history.data]);

  // Server logs with the pending optimistic cell overrides applied; every KPI,
  // chart and report memo reads this so toggles update synchronously.
  const displayLogs = useMemo(() => {
    const keys = Object.keys(overrides);
    if (keys.length === 0) return dashLogs;
    const byPair = new Map<string, DashLog>();
    for (const log of dashLogs) byPair.set(`${log.habitId}|${log.date}`, log);
    for (const key of keys) {
      const separator = key.lastIndexOf("|");
      if (separator <= 0) continue;
      if (overrides[key]) {
        byPair.set(key, { habitId: key.slice(0, separator), date: key.slice(separator + 1), status: "done" });
      } else {
        byPair.delete(key);
      }
    }
    return [...byPair.values()];
  }, [dashLogs, overrides]);

  const donePairs = useMemo(() => {
    const set = new Set<string>();
    for (const log of displayLogs) if (log.status === "done") set.add(`${log.habitId}|${log.date}`);
    return set;
  }, [displayLogs]);

  const activeRows = useMemo(() => activeHabits(dashHabits, month, today), [dashHabits, month, today]);
  const archivedHabits = useMemo(() => dashHabits.filter((habit) => habit.isArchived), [dashHabits]);
  const monthly = useMemo(() => monthlyCompliance(dashHabits, displayLogs, month, today), [dashHabits, displayLogs, month, today]);
  const previous = useMemo(
    () => monthlyCompliance(dashHabits, displayLogs, shiftMonthKey(month, -1), today),
    [dashHabits, displayLogs, month, today],
  );
  const delta = complianceDelta(monthly, previous);
  const streak = useMemo(() => longestStreak(dashHabits, displayLogs), [dashHabits, displayLogs]);
  const todayStats = useMemo(() => todayCompletion(dashHabits, displayLogs, today), [dashHabits, displayLogs, today]);
  const consistency = useMemo(
    () => weekdayConsistency(dashHabits, displayLogs, month, today),
    [dashHabits, displayLogs, month, today],
  );
  const milestone = useMemo(() => findMilestone(dashHabits, displayLogs, today), [dashHabits, displayLogs, today]);
  const reflection = useMemo(() => reflectionLine(dashHabits, displayLogs, today), [dashHabits, displayLogs, today]);
  const categoriesCount = categoriesCovered(activeRows);
  const dayCount = monthDays(month).length;
  const weeksInMonth = Math.ceil(dayCount / 7);
  const xpMonth = xpForLogs(displayLogs, month);
  const xpHistory = totalXp(displayLogs);
  const level = levelForXp(xpHistory);
  const levelProgress = Math.round(((xpHistory % 500) / 500) * 100);
  const todayDay = Number(today.slice(8));
  const todayPct = todayStats.total > 0 ? Math.round((todayStats.done / todayStats.total) * 100) : 0;

  const wireById = useMemo(() => new Map(wires.map((wire) => [wire.id, wire])), [wires]);
  const gridRows: HabitGridRow[] = activeRows
    .filter((habit) => (filter ? (habit.category?.trim() ?? "") === filter : true))
    .map((habit) => {
      const wire = wireById.get(habit.id);
      return {
        habit,
        color: wire?.color ?? null,
        icon: wire?.icon ?? null,
        subtitle: subtitleFor(habit),
      };
    });

  const reportRows: HabitReportRow[] = useMemo(
    () =>
      activeRows.map((habit) => {
        const perHabit = monthlyCompliance([habit], displayLogs, month, today);
        const perHabitLogs = displayLogs
          .filter((log) => log.habitId === habit.id)
          .map((log) => ({ habit_id: log.habitId, log_date: log.date, status: log.status }));
        const stats = habitStats(perHabitLogs, habit.startDate || rangeStart, today, habit.daysOfWeek);
        return {
          id: habit.id,
          name: habit.name,
          monthPct: perHabit.pct,
          doneDays: perHabit.done,
          currentStreak: stats.currentStreak,
          maxStreak: longestStreak([habit], displayLogs).days,
        };
      }),
    [activeRows, displayLogs, month, today, rangeStart],
  );

  function isDone(habitId: string, date: string): boolean {
    return donePairs.has(`${habitId}|${date}`);
  }

  /** Revalidate every habits cache a toggle/archive/create can stale. */
  async function refreshHabitCaches(): Promise<void> {
    await Promise.all([
      mutate(HABITS_LIST_KEY),
      mutate(historyKey),
      mutate(HABITS_TODAY_KEY),
      mutate(DASHBOARD_HABITS_TODAY_KEY),
    ]);
  }

  async function handleToggle(habitId: string, date: string): Promise<void> {
    const key = `${habitId}|${date}`;
    const currentlyDone = isDone(habitId, date);
    setOverrides((prev) => ({ ...prev, [key]: !currentlyDone }));
    try {
      await toggleHabitLog(habitId, date, currentlyDone);
      await refreshHabitCaches();
    } catch {
      setToast(t("habitsDashboard.toggleFailed"));
    } finally {
      setOverrides((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  async function handleArchive(habitId: string): Promise<void> {
    const name = dashHabits.find((habit) => habit.id === habitId)?.name ?? "";
    if (!window.confirm(t("habitsDashboard.archiveConfirm", { name }))) return;
    try {
      await archiveHabit(habitId, true);
      await refreshHabitCaches();
    } catch {
      setToast(t("habitsDashboard.archiveFailed"));
    }
  }

  async function handleUnarchive(habitId: string): Promise<void> {
    try {
      await archiveHabit(habitId, false);
      await refreshHabitCaches();
    } catch {
      setToast(t("habitsDashboard.archiveFailed"));
    }
  }

  async function handleCreated(): Promise<void> {
    await refreshHabitCaches();
  }

  function retry(): void {
    void mutate(HABITS_LIST_KEY);
    void mutate(historyKey);
  }

  function go(deltaMonths: number): void {
    setVisibleMonth((prev) => {
      const next = shiftMonthKey(prev, deltaMonths);
      if (next < minMonth) return minMonth;
      if (next > currentMonth) return currentMonth;
      return next;
    });
  }

  const loading = habits.isLoading || (history.isLoading && !history.data);
  const loadFailed = habits.error || history.error;
  const parts = monthParts(month) ?? { name: month, year: "" };
  const streakLabel =
    streak.habitNames.length === 1
      ? t("habitsDashboard.streakHabitsOne", { a: streak.habitNames[0] })
      : streak.habitNames.length === 2
        ? t("habitsDashboard.streakHabitsPair", { a: streak.habitNames[0], b: streak.habitNames[1] })
        : streak.habitNames.length > 2
          ? t("habitsDashboard.streakHabitsMore", {
              a: streak.habitNames[0],
              b: streak.habitNames[1],
              n: streak.habitNames.length - 2,
            })
          : "";

  const canonicalCategories = [
    { value: "Salud & Físico", labelKey: "habitsDashboard.filterHealth" as EsKey },
    { value: "Productividad", labelKey: "habitsDashboard.filterProductivity" as EsKey },
    { value: "Mentalidad", labelKey: "habitsDashboard.filterMind" as EsKey },
  ];
  const extraCategories = useMemo(() => {
    const seen = new Set<string>();
    for (const habit of activeRows) {
      const category = habit.category?.trim();
      if (category && !canonicalCategories.some((tab) => tab.value === category)) seen.add(category);
    }
    return [...seen];
  }, [activeRows]);
  const categoryCount = (value: string): number =>
    activeRows.filter((habit) => (habit.category?.trim() ?? "") === value).length;

  const archivedSection =
    archivedHabits.length > 0 ? (
      <section className="rounded-2xl border border-white/5 bg-gradient-to-b from-hull/40 to-deck/60 px-4 py-3">
        <button
          type="button"
          aria-expanded={archivedOpen}
          onClick={() => setArchivedOpen((prev) => !prev)}
          className="font-display text-sm text-instrument/70 transition-colors hover:text-signal"
        >
          {t("habitsDashboard.archivedSection", { n: archivedHabits.length })}
        </button>
        {archivedOpen ? (
          <ul className="mt-3 flex flex-col gap-2">
            {archivedHabits.map((habit) => (
              <li
                key={habit.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-deck/50 px-3 py-2"
              >
                <span className="truncate text-sm text-instrument/80">{habit.name}</span>
                <button
                  type="button"
                  aria-label={t("habitsDashboard.unarchiveLabel", { name: habit.name })}
                  onClick={() => void handleUnarchive(habit.id)}
                  className="shrink-0 rounded-lg border border-hull px-3 py-1 font-display text-xs text-instrument transition-colors hover:border-signal hover:text-signal"
                >
                  {t("habitsDashboard.unarchive")}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    ) : null;

  return (
    <div className="mx-auto flex w-full max-w-[1060px] flex-col gap-5">
      <header className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-signal/30 bg-signal/10 px-3 py-1 font-display text-[11px] uppercase tracking-widest text-signal">
            <span aria-hidden="true" className="animate-glow-pulse h-1.5 w-1.5 rounded-full bg-signal" />
            {t("habitsDashboard.livePill")}
            <span aria-hidden="true">•</span>
            <span className="normal-case text-instrument/60">{t("habitsDashboard.cycleActive", { n: dayCount })}</span>
          </p>
          <h1 className="font-deck-display mt-4 text-[40px] font-bold leading-tight tracking-wide text-instrument">
            {t("habitsDashboard.title")}
          </h1>
          <p className="mt-2 max-w-[640px] text-sm text-instrument/60">{t("habitsDashboard.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label={t("habitsDashboard.monthNav")}
            className="inline-flex items-center gap-1 rounded-2xl border border-hull bg-deck/70 p-1.5"
          >
            <button
              type="button"
              aria-label={t("habitsDashboard.monthPrev")}
              disabled={month <= minMonth}
              onClick={() => go(-1)}
              className="rounded-lg p-1.5 transition-colors hover:bg-signal/10 hover:text-signal disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-instrument"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <span aria-live="polite" className="flex min-w-36 items-center justify-center gap-2 px-1">
              <CalendarIcon className="h-4 w-4 text-signal" />
              <span className="flex flex-col leading-tight">
                <span className="font-display text-sm font-semibold text-instrument">{parts.name}</span>
                <span className="font-mono text-[11px] tabular-nums text-instrument/50">{parts.year}</span>
              </span>
            </span>
            <button
              type="button"
              aria-label={t("habitsDashboard.monthNext")}
              disabled={month >= currentMonth}
              onClick={() => go(1)}
              className="rounded-lg p-1.5 transition-colors hover:bg-signal/10 hover:text-signal disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-instrument"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#38BDF8] to-[#4F7CFF] px-4 py-2.5 font-display text-sm font-semibold text-white shadow-[0_0_24px_-6px_#38BDF8] transition-transform hover:scale-[1.02]"
          >
            <PlusIcon className="h-4 w-4" />
            {t("habitsDashboard.addHabit")}
          </button>
        </div>
      </header>

      {loading ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-5">
          <p className="sr-only">{t("common.loading")}</p>
          <div className="grid grid-cols-1 gap-[18px] min-[700px]:grid-cols-2 min-[1200px]:grid-cols-4">
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
          </div>
          <Skeleton className="h-14" />
          <Skeleton className="h-72" />
          <div className="flex flex-col gap-4 min-[1200px]:flex-row">
            <Skeleton className="h-64 xl:w-3/5" />
            <Skeleton className="h-64 xl:w-2/5" />
          </div>
        </div>
      ) : loadFailed ? (
        <div role="alert" className={`${CARD} flex flex-col items-start gap-3`}>
          <p className="font-display text-sm font-semibold text-instrument">{t("habitsDashboard.loadFailed")}</p>
          <button
            type="button"
            onClick={retry}
            className="rounded-xl border border-hull px-4 py-2 font-display text-sm text-instrument transition-colors hover:border-signal hover:text-signal"
          >
            {t("common.retry")}
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-[18px] min-[700px]:grid-cols-2 min-[1200px]:grid-cols-4">
            <section aria-label={t("habitsDashboard.kpiMonthlyCompliance")} className={KPI_CARD}>
              <p className={KPI_LABEL}>{t("habitsDashboard.kpiMonthlyCompliance")}</p>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="font-display text-[44px] font-bold leading-none tabular-nums text-instrument">
                    {monthly.pct}
                    <span className="text-2xl text-signal">%</span>
                  </p>
                  {delta !== null ? (
                    delta === 0 ? (
                      <p className="mt-1 inline-flex items-center rounded-full bg-instrument/10 px-2 py-0.5 text-xs font-semibold text-instrument/60">
                        {t("habitsDashboard.deltaNeutral", { n: 0 })}
                      </p>
                    ) : (
                      <p className={`mt-1 text-xs font-semibold ${delta > 0 ? "text-[#22C55E]" : "text-alert"}`}>
                        {delta > 0 ? `↗ +${delta}%` : `↘ ${delta}%`}
                      </p>
                    )
                  ) : null}
                  <p className="mt-1 text-xs text-instrument/50">
                    {t("habitsDashboard.monthlyGoal", { n: MONTHLY_GOAL_PCT })}
                  </p>
                </div>
                <ProgressRing pct={monthly.pct} />
              </div>
            </section>

            <section aria-label={t("habitsDashboard.kpiStreak")} className={KPI_CARD}>
              <p className={KPI_LABEL}>{t("habitsDashboard.kpiStreak")}</p>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-display text-[44px] font-bold leading-none tabular-nums text-instrument">
                      {streak.days}
                    </p>
                    <p className="text-sm font-semibold leading-tight text-signal">
                      {t("habitsDashboard.streakDays")}
                      <br />
                      {t("habitsDashboard.streakInARow")}
                    </p>
                  </div>
                  {streakLabel ? <p className="mt-1 text-xs text-instrument/50">{streakLabel}</p> : null}
                </div>
                <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl bg-sky/15 text-sky">
                  <FlameIcon className="h-6 w-6" />
                </span>
              </div>
            </section>

            <section aria-label={t("habitsDashboard.kpiActive")} className={KPI_CARD}>
              <p className={KPI_LABEL}>{t("habitsDashboard.kpiActive")}</p>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="flex items-baseline gap-2">
                    <span className="font-display text-[44px] font-bold leading-none tabular-nums text-instrument">
                      {activeRows.length}
                    </span>
                    <span className="text-sm text-instrument/60">{t("habitsDashboard.activeTracking")}</span>
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-instrument/50">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-flow" />
                    {categoriesCount === 1
                      ? t("habitsDashboard.categoriesCoveredOne", { n: categoriesCount })
                      : t("habitsDashboard.categoriesCoveredMany", { n: categoriesCount })}
                  </p>
                </div>
                <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl bg-instrument/10 text-instrument/70">
                  <ListCheckIcon className="h-6 w-6" />
                </span>
              </div>
            </section>

            <section aria-label={t("habitsDashboard.kpiToday", { n: todayDay })} className={KPI_CARD}>
              <p className={KPI_LABEL}>{t("habitsDashboard.kpiToday", { n: todayDay })}</p>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="flex items-baseline gap-1">
                    <span className="font-display text-[44px] font-bold leading-none tabular-nums text-[#4ADE80]">
                      {todayStats.done}
                    </span>
                    <span className="font-display text-xl tabular-nums text-instrument/40">
                      {t("habitsDashboard.todayTotal", { n: todayStats.total })}
                    </span>
                    <span className="ml-1 text-sm font-semibold text-[#4ADE80]">
                      {t("habitsDashboard.todayPct", { n: todayPct })}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-instrument/50">
                    {todayStats.total === 0
                      ? "—"
                      : todayStats.done >= todayStats.total
                        ? t("habitsDashboard.todayPerfect")
                        : t("habitsDashboard.todayMissing", { n: todayStats.total - todayStats.done })}
                  </p>
                </div>
                <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl bg-[#22C55E]/15 text-[#22C55E]">
                  <CheckCircleIcon className="h-6 w-6" />
                </span>
              </div>
            </section>
          </div>

          {activeRows.length === 0 ? (
            <>
              <section className={`${CARD} flex flex-col items-center gap-3 py-12 text-center`}>
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-signal/15 text-signal">
                  <ListCheckIcon className="h-7 w-7" />
                </span>
                <h2 className="font-display text-lg font-semibold text-instrument">{t("habitsDashboard.emptyTitle")}</h2>
                <p className="max-w-md text-sm text-instrument/50">{t("habitsDashboard.emptyHint")}</p>
                <button
                  type="button"
                  onClick={() => setModalOpen(true)}
                  className="mt-1 rounded-xl bg-signal px-4 py-2 font-display text-sm font-semibold text-deck transition-colors hover:bg-signal/90"
                >
                  {t("habitsDashboard.emptyCta")}
                </button>
              </section>
              {archivedSection}
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 bg-gradient-to-b from-hull/40 to-deck/60 px-4 py-3">
                <div
                  role="group"
                  aria-label={t("habitsDashboard.filterGroup")}
                  className="flex flex-wrap items-center gap-2"
                >
                  <button
                    type="button"
                    aria-pressed={filter === null}
                    onClick={() => setFilter(null)}
                    className={`rounded-full px-3 py-1 text-xs transition-colors ${
                      filter === null ? "bg-signal font-semibold text-deck" : "text-instrument/60 hover:text-signal"
                    }`}
                  >
                    {t("habitsDashboard.filterAll", { n: activeRows.length })}
                  </button>
                  {canonicalCategories.map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      aria-pressed={filter === tab.value}
                      onClick={() => setFilter((prev) => (prev === tab.value ? null : tab.value))}
                      className={`rounded-full px-3 py-1 text-xs transition-colors ${
                        filter === tab.value ? "bg-signal font-semibold text-deck" : "text-instrument/60 hover:text-signal"
                      }`}
                    >
                      {`${t(tab.labelKey)} (${categoryCount(tab.value)})`}
                    </button>
                  ))}
                  {extraCategories.map((category) => (
                    <button
                      key={category}
                      type="button"
                      aria-pressed={filter === category}
                      onClick={() => setFilter((prev) => (prev === category ? null : category))}
                      className={`rounded-full px-3 py-1 text-xs transition-colors ${
                        filter === category ? "bg-signal font-semibold text-deck" : "text-instrument/60 hover:text-signal"
                      }`}
                    >
                      {`${category} (${categoryCount(category)})`}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-instrument/60">
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-3 w-3 rounded bg-signal" />
                    {t("habitsDashboard.legendDone")}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-3 w-3 rounded bg-hull/60" />
                    {t("habitsDashboard.legendPending")}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-3 w-3 rounded bg-black/40" />
                    {t("habitsDashboard.legendFuture")}
                  </span>
                  {month === currentMonth ? (
                    <span className="rounded-full border border-signal/30 bg-signal/10 px-2.5 py-0.5 font-display text-[11px] uppercase tracking-widest text-signal">
                      {t("habitsDashboard.todayPill", { n: todayDay })}
                    </span>
                  ) : null}
                </div>
              </div>

              <section aria-label={t("habitsDashboard.title")} className={CARD}>
                <HabitGrid
                  rows={gridRows}
                  days={monthRangeDays(month)}
                  monthKey={month}
                  todayYmd={today}
                  isDone={isDone}
                  onToggle={(habitId, date) => void handleToggle(habitId, date)}
                  onArchive={(habitId) => void handleArchive(habitId)}
                />
              </section>

              {archivedSection}

              <div className="flex flex-col gap-4 min-[1200px]:flex-row">
                <div className="min-[1200px]:w-3/5">
                  <WeeklyChart
                    values={consistency.values}
                    avg={consistency.avg}
                    best={consistency.best}
                    weeks={weeksInMonth}
                    monthLabel={monthLabel(month)}
                    report={reportRows}
                  />
                </div>
                <div className="flex flex-col gap-4 min-[1200px]:w-2/5">
                  <section aria-label={t("habitsDashboard.milestonePill")} className={CARD}>
                    <div className="flex items-center gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#22C55E]/15 text-[#22C55E]">
                        <ShieldCheckIcon className="h-6 w-6" />
                      </span>
                      <span className="rounded-full border border-[#22C55E]/30 bg-[#22C55E]/10 px-3 py-0.5 font-display text-[11px] uppercase tracking-widest text-[#4ADE80]">
                        {t("habitsDashboard.milestonePill")}
                      </span>
                    </div>
                    {milestone ? (
                      <>
                        <h2 className="mt-3 font-display text-lg font-semibold text-instrument">
                          {milestone.kind === "category"
                            ? t("habitsDashboard.milestoneCategoryTitle", { category: milestone.category })
                            : t("habitsDashboard.milestoneStreakTitle", { n: milestone.days })}
                        </h2>
                        <p className="mt-1 text-sm text-instrument/60">
                          {milestone.kind === "category" ? (
                            <>
                              {t("habitsDashboard.milestoneCategoryBodyPre")}
                              <strong className="font-semibold text-[#4ADE80]">
                                {t("habitsDashboard.milestoneCategoryBodyBold")}
                              </strong>
                              {t("habitsDashboard.milestoneCategoryBodyPost", { category: milestone.category })}
                            </>
                          ) : (
                            t("habitsDashboard.milestoneStreakBody", {
                              n: milestone.days,
                              habit: milestone.habitName,
                            })
                          )}
                        </p>
                      </>
                    ) : (
                      <p className="mt-3 text-sm text-instrument/60">{t("habitsDashboard.milestoneEmpty")}</p>
                    )}
                    <div className="mt-4 rounded-xl border border-white/5 bg-deck/50 p-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-instrument/60">{t("habitsDashboard.milestoneNeuro", { n: level })}</span>
                        <span className="font-mono tabular-nums text-signal">{t("habitsDashboard.milestoneXp", { n: xpMonth })}</span>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-hull/60">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#38BDF8] to-[#4F7CFF]"
                          style={{ width: `${levelProgress}%` }}
                        />
                      </div>
                    </div>
                  </section>

                  <section aria-label={t("habitsDashboard.reflectionTitle")} className={CARD}>
                    <div className="flex items-center gap-2">
                      <BulbIcon className="h-4 w-4 text-signal" />
                      <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-instrument">
                        {t("habitsDashboard.reflectionTitle")}
                      </h2>
                    </div>
                    <p className="mt-3 text-sm text-instrument/60">
                      {reflection
                        ? t("habitsDashboard.reflectionLine", { habit: reflection.habitName, n: reflection.points })
                        : t("habitsDashboard.reflectionEmpty")}
                    </p>
                  </section>
                </div>
              </div>
            </>
          )}
        </>
      )}

      <HabitCreateModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={handleCreated} />

      {toast ? (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-50 rounded-xl border border-alert/40 bg-deck px-4 py-3 text-sm text-instrument shadow-lg"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
