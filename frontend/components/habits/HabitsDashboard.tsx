"use client";

import { useEffect, useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { t, type EsKey } from "@/lib/i18n";
import { DeckEmptyState } from "@/components/dashboard/DeckCard";
import { deck } from "@/components/ui/deckStyles";
import KpiTile from "@/components/ui/KpiTile";
import { DASHBOARD_HABITS_TODAY_KEY } from "@/lib/api/dashboard";
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
  currentStreakDays,
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

const CARD = "rounded-2xl border border-hair bg-card p-[22px] shadow-sm";

/** Known categories keep their real i18n labels and lead the tab order. */
const CANONICAL_CATEGORIES = [
  { value: "Salud & Físico", labelKey: "habitsDashboard.filterHealth" as EsKey },
  { value: "Productividad", labelKey: "habitsDashboard.filterProductivity" as EsKey },
  { value: "Mentalidad", labelKey: "habitsDashboard.filterMind" as EsKey },
];

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

/** Inline stand-in for the prototype's `psychology` glyph: the real level row. */
function BrainIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8.2 3.2A2.4 2.4 0 005.4 5c-1.2.3-2 1.3-2 2.5 0 .8.3 1.4.9 1.9-.4.5-.6 1-.6 1.7 0 1.5 1.2 2.7 2.7 2.7h.6v3h4.6V6.1a2.9 2.9 0 00-3.4-2.9z" />
      <path d="M13.4 3.6a2.6 2.6 0 012.5 1.9c.9.3 1.5 1.2 1.5 2.2 0 .7-.3 1.3-.7 1.7.3.4.4.9.4 1.4 0 1.4-1.1 2.5-2.5 2.5H14" />
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
  const radius = 24;
  const length = 2 * Math.PI * radius;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" className="shrink-0">
      <circle cx="28" cy="28" r={radius} fill="none" stroke="var(--color-container-highest)" strokeWidth="5" />
      <circle
        cx="28"
        cy="28"
        r={radius}
        fill="none"
        stroke="var(--color-signal)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={length.toFixed(1)}
        strokeDashoffset={(length * (1 - clamped / 100)).toFixed(1)}
        transform="rotate(-90 28 28)"
        className="drop-shadow-[0_0_6px_rgba(56,189,248,0.6)]"
      />
    </svg>
  );
}

function DonutIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 3.5a6.5 6.5 0 016.4 7.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-2xl bg-card ${className ?? ""}`} />;
}

export interface HabitsDashboardProps {
  /** Test seam; defaults to the user's real local today. */
  todayYmd?: string;
}

/**
 * `/dashboard/habitos/` dashboard (spec §2): header + month navigator, 4 KPI
 * cards, category filters/legend, the month grid and the weekly/milestone/
 * reflection bottom row. Owns the visible-month state and fetches logs in two
 * ranges that always fit the backend `/habits/logs` 366-day cap: a rolling
 * 12-month history window anchored to today (streaks/delta/milestone/XP) and
 * the visible month itself (grid/compliance/chart). Every number comes from
 * `habitDashboard` helpers (no NaN/Infinity).
 */
export default function HabitsDashboard({ todayYmd }: HabitsDashboardProps) {
  const { mutate } = useSWRConfig();
  const today = todayYmd ?? todayYmdLocal();
  const currentMonth = today.slice(0, 7);
  // History is anchored to today (not the visible month), so its span stays
  // under the 366-day API cap no matter how far back the user navigates.
  const historyStartMonth = shiftMonthKey(currentMonth, -11);
  const historyStart = `${historyStartMonth}-01`;
  const [visibleMonth, setVisibleMonth] = useState(currentMonth);
  const month = visibleMonth < historyStartMonth ? historyStartMonth : visibleMonth > currentMonth ? currentMonth : visibleMonth;

  const habits = useHabitsList();
  const monthStart = `${month}-01`;
  const monthEnd = monthRangeDays(month).slice(-1)[0] ?? `${month}-28`;
  const historyKey = habitsHistoryKey(historyStart, today);
  const history = useHabitsHistory(historyStart, today);
  const monthFetchKey = habitsHistoryKey(monthStart, monthEnd);
  const monthFetch = useHabitsHistory(monthStart, monthEnd);

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
  const historyLogs = useMemo(() => (history.data ?? []).map(toDashLog), [history.data]);
  const monthFetchLogs = useMemo(() => (monthFetch.data ?? []).map(toDashLog), [monthFetch.data]);

  // Union of both server ranges, deduped by habit/day; the visible-month fetch
  // wins on conflict. Every KPI, chart and report memo reads this merged set.
  const serverLogs = useMemo(() => {
    const byPair = new Map<string, DashLog>();
    for (const log of historyLogs) byPair.set(`${log.habitId}|${log.date}`, log);
    for (const log of monthFetchLogs) byPair.set(`${log.habitId}|${log.date}`, log);
    return [...byPair.values()];
  }, [historyLogs, monthFetchLogs]);

  // Server logs with the pending optimistic cell overrides applied; every KPI,
  // chart and report memo reads this so toggles update synchronously.
  const displayLogs = useMemo(() => {
    const keys = Object.keys(overrides);
    if (keys.length === 0) return serverLogs;
    const byPair = new Map<string, DashLog>();
    for (const log of serverLogs) byPair.set(`${log.habitId}|${log.date}`, log);
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
  }, [serverLogs, overrides]);

  const donePairs = useMemo(() => {
    const set = new Set<string>();
    for (const log of displayLogs) if (log.status === "done") set.add(`${log.habitId}|${log.date}`);
    return set;
  }, [displayLogs]);

  const activeRows = useMemo(() => activeHabits(dashHabits, month, today), [dashHabits, month, today]);
  const archivedHabits = useMemo(() => dashHabits.filter((habit) => habit.isArchived), [dashHabits]);
  // The CTA empty state only shows when nothing is left to track: no habits at
  // all or every habit archived (archived rows live in their own section).
  // Habits that exist but are inactive in the visible month get the neutral
  // `noActiveInMonth` card instead.
  const hasTrackableHabits = dashHabits.some((habit) => !habit.isArchived);
  const monthly = useMemo(() => monthlyCompliance(dashHabits, displayLogs, month, today), [dashHabits, displayLogs, month, today]);
  // The previous month only counts when it sits inside the fetched history
  // window; at the window edge its data is absent, so the delta hides.
  const previousMonth = shiftMonthKey(month, -1);
  const previous = useMemo(
    () =>
      previousMonth < historyStartMonth
        ? null
        : monthlyCompliance(dashHabits, displayLogs, previousMonth, today),
    [dashHabits, displayLogs, previousMonth, historyStartMonth, today],
  );
  const delta = previous ? complianceDelta(monthly, previous) : null;
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

  const reportRows: HabitReportRow[] = useMemo(
    () =>
      activeRows.map((habit) => {
        const perHabit = monthlyCompliance([habit], displayLogs, month, today);
        return {
          id: habit.id,
          name: habit.name,
          monthPct: perHabit.pct,
          doneDays: perHabit.done,
          // Same guarded helper as the milestone: ended habits report 0.
          currentStreak: currentStreakDays(habit, displayLogs, today),
          maxStreak: longestStreak([habit], displayLogs).days,
        };
      }),
    [activeRows, displayLogs, month, today],
  );

  // The matrix reads the same per-habit numbers as the weekly report (one
  // source, so the Racha/Éxito columns can never drift from the modal).
  const reportById = useMemo(() => new Map(reportRows.map((row) => [row.id, row])), [reportRows]);
  const gridRows: HabitGridRow[] = activeRows
    .filter((habit) => (filter ? (habit.category?.trim() ?? "") === filter : true))
    .map((habit) => {
      const wire = wireById.get(habit.id);
      const report = reportById.get(habit.id);
      return {
        habit,
        color: wire?.color ?? null,
        icon: wire?.icon ?? null,
        subtitle: subtitleFor(habit),
        streakDays: report?.currentStreak ?? 0,
        successPct: report?.monthPct ?? 0,
      };
    });

  // One tab per real category with a real count; a category with no habits in
  // the visible month is omitted honestly (no empty tabs).
  const categoryTabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const habit of activeRows) {
      const category = habit.category?.trim();
      if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    const tabs: Array<{ value: string; label: string; count: number }> = [];
    for (const tab of CANONICAL_CATEGORIES) {
      const count = counts.get(tab.value) ?? 0;
      if (count > 0) tabs.push({ value: tab.value, label: t(tab.labelKey), count });
    }
    for (const [value, count] of counts) {
      if (!CANONICAL_CATEGORIES.some((tab) => tab.value === value)) tabs.push({ value, label: value, count });
    }
    return tabs;
  }, [activeRows]);

  function isDone(habitId: string, date: string): boolean {
    return donePairs.has(`${habitId}|${date}`);
  }

  /** Revalidate every habits cache a toggle/archive/create can stale. */
  async function refreshHabitCaches(): Promise<void> {
    await Promise.all([
      mutate(HABITS_LIST_KEY),
      mutate(historyKey),
      mutate(monthFetchKey),
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
    void mutate(monthFetchKey);
  }

  function go(deltaMonths: number): void {
    setVisibleMonth((prev) => {
      const next = shiftMonthKey(prev, deltaMonths);
      if (next < historyStartMonth) return historyStartMonth;
      if (next > currentMonth) return currentMonth;
      return next;
    });
  }

  const loading =
    habits.isLoading || (history.isLoading && !history.data) || (monthFetch.isLoading && !monthFetch.data);
  const loadFailed = habits.error || history.error || monthFetch.error;
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

  const archivedSection =
    archivedHabits.length > 0 ? (
      <section className="rounded-2xl border border-hair bg-card px-4 py-3">
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
                className="flex items-center justify-between gap-3 rounded-xl border border-hair bg-panel px-3 py-2"
              >
                <span className="truncate text-sm text-instrument/80">{habit.name}</span>
                <button
                  type="button"
                  aria-label={t("habitsDashboard.unarchiveLabel", { name: habit.name })}
                  onClick={() => void handleUnarchive(habit.id)}
                  className="shrink-0 rounded-lg border border-hair px-3 py-1 font-display text-xs text-instrument transition-colors hover:border-signal hover:text-signal"
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
    <div className="flex w-full flex-col gap-5">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={deck.focusChip}>
              <span aria-hidden="true" className={deck.focusChipDot} />
              {t("habitsDashboard.livePill")}
            </span>
            <span aria-hidden="true" className="text-xs text-slate-500">
              •
            </span>
            <span className="text-xs font-medium text-slate-400">
              {t("habitsDashboard.cycleActive", { n: dayCount })}
            </span>
          </div>
          <h1 className="font-deck-display mt-3 text-headline-xl-mobile font-bold tracking-tight text-instrument sm:text-headline-xl">
            {t("habitsDashboard.title")}
          </h1>
          <p className="mt-1 max-w-[640px] text-body-md text-slate-400">{t("habitsDashboard.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label={t("habitsDashboard.monthNav")} className={deck.calendarNavGroup}>
            <button
              type="button"
              aria-label={t("habitsDashboard.monthPrev")}
              disabled={month <= historyStartMonth}
              onClick={() => go(-1)}
              className={deck.calendarNavButton}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <span aria-live="polite" className="flex min-w-32 items-center justify-center gap-2 px-1">
              <CalendarIcon className="h-4 w-4 text-signal" />
              <span className="flex flex-col leading-tight">
                <span className="font-display text-sm font-semibold text-instrument">{parts.name}</span>
                <span className="font-mono text-[10px] tabular-nums text-slate-500">{parts.year}</span>
              </span>
            </span>
            <button
              type="button"
              aria-label={t("habitsDashboard.monthNext")}
              disabled={month >= currentMonth}
              onClick={() => go(1)}
              className={deck.calendarNavButton}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
          <button type="button" onClick={() => setModalOpen(true)} className={deck.heroCta}>
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
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <Skeleton className="h-64 lg:col-span-7" />
            <Skeleton className="h-64 lg:col-span-5" />
          </div>
        </div>
      ) : loadFailed ? (
        <div role="alert" className={`${CARD} flex flex-col items-start gap-3`}>
          <p className="font-display text-sm font-semibold text-instrument">{t("habitsDashboard.loadFailed")}</p>
          <button
            type="button"
            onClick={retry}
            className="rounded-xl border border-hair px-4 py-2 font-display text-sm text-instrument transition-colors hover:border-signal hover:text-signal"
          >
            {t("common.retry")}
          </button>
        </div>
      ) : (
        <>
          <section aria-label={t("habitsDashboard.kpiSummary")} className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4 lg:gap-4">
            <KpiTile
              label={t("habitsDashboard.kpiMonthlyCompliance")}
              icon={<DonutIcon className="h-3.5 w-3.5" />}
              signal
              glow="corner"
              value={String(monthly.pct)}
              valueClass={deck.kpiValue}
              valueSuffix={
                <>
                  <span className="font-mono text-lg font-bold text-signal">%</span>
                  {delta === null ? null : delta === 0 ? (
                    <span className={deck.kpiChipNeutral}>{t("habitsDashboard.deltaNeutral")}</span>
                  ) : (
                    <span className={delta > 0 ? deck.kpiDeltaUp : deck.kpiDeltaDown}>
                      {delta > 0
                        ? t("habitsDashboard.deltaUp", { n: delta })
                        : t("habitsDashboard.deltaDown", { n: delta })}
                    </span>
                  )}
                </>
              }
            >
              <div className="mt-3 flex items-end justify-between gap-2">
                <p className="text-[11px] text-slate-500">
                  {t("habitsDashboard.monthlyGoal", { n: MONTHLY_GOAL_PCT })}
                </p>
                <ProgressRing pct={monthly.pct} />
              </div>
            </KpiTile>

            <KpiTile
              label={t("habitsDashboard.kpiStreak")}
              icon={<FlameIcon className="h-3.5 w-3.5" />}
              signal
              value={String(streak.days)}
              valueClass={deck.kpiValue}
              unit={`${t("habitsDashboard.streakDays")} ${t("habitsDashboard.streakInARow")}`}
            >
              {streakLabel ? (
                <p className={deck.kpiFooter}>
                  <span className="line-clamp-2">{streakLabel}</span>
                </p>
              ) : null}
            </KpiTile>

            <KpiTile
              label={t("habitsDashboard.kpiActive")}
              icon={<ListCheckIcon className="h-3.5 w-3.5" />}
              value={String(activeRows.length)}
              valueClass={deck.kpiValue}
              unit={t("habitsDashboard.activeTracking")}
            >
              {categoryTabs.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {categoryTabs.map((tab) => (
                    <span key={tab.value} className={deck.rowChip}>{`${tab.label} (${tab.count})`}</span>
                  ))}
                </div>
              ) : null}
              <p className={deck.kpiFooter}>
                {categoriesCount === 1
                  ? t("habitsDashboard.categoriesCoveredOne", { n: categoriesCount })
                  : t("habitsDashboard.categoriesCoveredMany", { n: categoriesCount })}
              </p>
            </KpiTile>

            <KpiTile
              label={t("habitsDashboard.kpiToday", { n: todayDay })}
              icon={<CheckCircleIcon className="h-3.5 w-3.5" />}
              signal
              value={String(todayStats.done)}
              valueClass={deck.kpiValueFlow}
              unit={t("habitsDashboard.todayTotal", { n: todayStats.total })}
              valueSuffix={
                <span className="font-mono text-xs font-bold text-flow-soft">
                  {t("habitsDashboard.todayPct", { n: todayPct })}
                </span>
              }
            >
              {todayStats.total > 0 ? (
                <div
                  role="progressbar"
                  aria-label={t("habitsDashboard.todayProgress")}
                  aria-valuenow={todayPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className={deck.kpiProgressTrack}
                >
                  <div className={deck.kpiProgressFillFlow} style={{ width: `${todayPct}%` }} />
                </div>
              ) : null}
              <p className={deck.kpiFooter}>
                {todayStats.total === 0
                  ? "—"
                  : todayStats.done >= todayStats.total
                    ? t("habitsDashboard.todayPerfect")
                    : t("habitsDashboard.todayMissing", { n: todayStats.total - todayStats.done })}
              </p>
            </KpiTile>
          </section>

          {!hasTrackableHabits ? (
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
              <div className="flex flex-col gap-3 rounded-xl border border-hair bg-panel/80 p-3.5 backdrop-blur-md lg:flex-row lg:items-center lg:justify-between">
                <div
                  role="group"
                  aria-label={t("habitsDashboard.filterGroup")}
                  className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0"
                >
                  <button
                    type="button"
                    aria-pressed={filter === null}
                    onClick={() => setFilter(null)}
                    className={filter === null ? deck.filterTabActive : deck.filterTabIdle}
                  >
                    {t("habitsDashboard.filterAll", { n: activeRows.length })}
                  </button>
                  {categoryTabs.map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      aria-pressed={filter === tab.value}
                      onClick={() => setFilter((prev) => (prev === tab.value ? null : tab.value))}
                      className={filter === tab.value ? deck.filterTabActive : deck.filterTabIdle}
                    >
                      {`${tab.label} (${tab.count})`}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-4 text-body-sm text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className={deck.legendSwatchDone} />
                    {t("habitsDashboard.legendDone")}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className={deck.legendSwatchPending} />
                    {t("habitsDashboard.legendPending")}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className={deck.legendSwatchFuture} />
                    {t("habitsDashboard.legendFuture")}
                  </span>
                  {month === currentMonth ? (
                    <span className={deck.todayChip}>{t("habitsDashboard.todayPill", { n: todayDay })}</span>
                  ) : null}
                </div>
              </div>

              {activeRows.length === 0 ? (
                <DeckEmptyState
                  icon={<CalendarIcon className="h-5 w-5" />}
                  title={t("habitsDashboard.noActiveInMonth")}
                  hint={t("habitsDashboard.noActiveInMonthHint")}
                />
              ) : (
                <HabitGrid
                  rows={gridRows}
                  days={monthRangeDays(month)}
                  monthKey={month}
                  todayYmd={today}
                  isDone={isDone}
                  onToggle={(habitId, date) => void handleToggle(habitId, date)}
                  onArchive={(habitId) => void handleArchive(habitId)}
                />
              )}

              {archivedSection}

              {/* Bottom bento (prototype `habitos-desktop.html:697`): the weekly
                  chart takes `lg:col-span-7`, the achievement + reflection
                  column `lg:col-span-5`. */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-7">
                  <WeeklyChart
                    values={consistency.values}
                    avg={consistency.avg}
                    best={consistency.best}
                    weeks={weeksInMonth}
                    monthLabel={monthLabel(month)}
                    report={reportRows}
                  />
                </div>
                <div className="flex flex-col gap-4 lg:col-span-5">
                  <section aria-label={t("habitsDashboard.milestonePill")} className={deck.achievementCard}>
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-emerald-500/5 blur-2xl"
                    />
                    <div className="flex items-start justify-between gap-2">
                      <span className={deck.achievementIconTile}>
                        <ShieldCheckIcon className="h-[22px] w-[22px]" />
                      </span>
                      <span className={deck.achievementChip}>{t("habitsDashboard.milestonePill")}</span>
                    </div>
                    {milestone ? (
                      <>
                        <h2 className="mt-4 text-headline-md font-semibold text-instrument">
                          {milestone.kind === "category"
                            ? t("habitsDashboard.milestoneCategoryTitle", { category: milestone.category })
                            : t("habitsDashboard.milestoneStreakTitle", { n: milestone.days })}
                        </h2>
                        <p className="mt-1.5 text-body-md leading-relaxed text-muted">
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
                      <p className="mt-4 text-body-md text-muted">{t("habitsDashboard.milestoneEmpty")}</p>
                    )}
                    <div className={deck.achievementStatsRow}>
                      <span className="flex min-w-0 items-center gap-2">
                        <BrainIcon className="h-[18px] w-[18px] shrink-0 text-signal" />
                        <span className="truncate text-xs font-medium text-instrument">
                          {t("habitsDashboard.milestoneNeuro", { n: level })}
                        </span>
                      </span>
                      <span className={deck.achievementXpValue}>{t("habitsDashboard.milestoneXp", { n: xpMonth })}</span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={t("habitsDashboard.milestoneLevelProgress")}
                      aria-valuenow={levelProgress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className={deck.kpiProgressTrack}
                    >
                      <div className={deck.kpiProgressFillSignal} style={{ width: `${levelProgress}%` }} />
                    </div>
                  </section>

                  <section aria-label={t("habitsDashboard.reflectionTitle")} className={deck.reflectionCard}>
                    <span className={deck.reflectionIconTile}>
                      <BulbIcon className="h-5 w-5" />
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <h2 className={deck.reflectionTitle}>{t("habitsDashboard.reflectionTitle")}</h2>
                      <p className="mt-0.5 text-body-sm text-muted">
                        {reflection
                          ? t("habitsDashboard.reflectionLine", { habit: reflection.habitName, n: reflection.points })
                          : t("habitsDashboard.reflectionEmpty")}
                      </p>
                    </div>
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
