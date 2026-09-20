"use client";

import { useState } from "react";
import HabitsTrackerGrid, { monthRangeDays } from "@/components/productivity/HabitsTrackerGrid";
import { t } from "@/lib/i18n";
import { useHabitsToday } from "@/lib/api/productivity";
import { todayYmdLocal } from "@/lib/productivity/productivity";

// Display face for this screen: `font-deck-display` (Plus Jakarta Sans via
// next/font in the root layout, system fallback in globals.css).
// No global theme change, no CDN (same approach as the T1 login restyle).

/** Shift a `YYYY-MM` key by `delta` months. Garbage in, current month out. */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return monthKey;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

/** Long Spanish month label via Intl, e.g. "Septiembre de 2026". */
export function monthLabel(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return monthKey;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  const raw = new Intl.DateTimeFormat("es", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12.5 5l-5.5 5 5.5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M7.5 5l5.5 5-5.5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

const monthButtonClass =
  "rounded-full p-2 transition-colors hover:bg-signal/10 hover:text-signal disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-instrument focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal";

/**
 * Single-owner shell for the standalone habits page (`/dashboard/habitos/`).
 * Owns the `useHabitsToday` read (loading + error + retry) and the visible
 * month state; the grid keeps owning the month range logs
 * (`useHabitsHistory`) and the today-log action.
 */
export default function HabitsSection({ todayYmd }: { todayYmd?: string }) {
  const habits = useHabitsToday();

  const today = todayYmd ?? todayYmdLocal();
  const currentMonth = today.slice(0, 7);
  const minMonth = shiftMonthKey(currentMonth, -11);
  const [visibleMonth, setVisibleMonth] = useState(currentMonth);
  // Clamp defensively: the month only ever moves through the buttons below.
  const month = visibleMonth < minMonth ? minMonth : visibleMonth > currentMonth ? currentMonth : visibleMonth;

  function go(delta: number): void {
    setVisibleMonth((prev) => {
      const next = shiftMonthKey(prev, delta);
      if (next < minMonth) return minMonth;
      if (next > currentMonth) return currentMonth;
      return next;
    });
  }

  if (habits.isLoading) {
    return (
      <p role="status" aria-busy="true" className="text-sm text-instrument/60">
        {t("common.loading")}
      </p>
    );
  }

  if (habits.error) {
    return (
      <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-5">
        <h2 className="font-display text-lg font-semibold">{t("productivity.tracker.loadFailed")}</h2>
        <button
          type="button"
          onClick={() => void habits.mutate()}
          className="mt-4 rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Cheap local breadcrumb (habits only, no global topbar). */}
      <nav aria-label={t("dashboard.breadcrumbNav")} className="text-xs text-instrument/50">
        <ol className="flex items-center gap-1.5">
          <li>{t("dashboard.panel")}</li>
          <li aria-hidden="true">›</li>
          <li aria-current="page" className="text-instrument/80">
            {t("productivity.tracker.title")}
          </li>
        </ol>
      </nav>
      <header className="relative overflow-hidden rounded-xl border border-hull bg-hull/40 p-5 sm:p-6">
        <div aria-hidden="true" className="bg-grid-pattern pointer-events-none absolute inset-0 opacity-60" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/4 h-48 w-96 rounded-full bg-signal/15 blur-3xl"
        />
        <div className="relative">
          <p className="inline-flex items-center gap-2 rounded-full border border-signal/30 bg-signal/10 px-3 py-1 font-display text-[11px] uppercase tracking-widest text-signal">
            <span aria-hidden="true" className="animate-glow-pulse h-1.5 w-1.5 rounded-full bg-signal" />
            {t("productivity.tracker.heroLive")}
            <span aria-hidden="true">•</span>
            {t("productivity.tracker.heroCycle", { n: monthRangeDays(month).length })}
          </p>
          <h1 className="font-deck-display mt-3 text-balance text-2xl font-semibold tracking-wide sm:text-3xl">
            {t("productivity.tracker.title")}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-instrument/60">{t("productivity.tracker.heroDescription")}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label={t("productivity.tracker.monthNav")}
              className="inline-flex items-center gap-1 rounded-full border border-hull bg-deck/60 p-1"
            >
              <button
                type="button"
                aria-label={t("productivity.tracker.monthPrev")}
                disabled={month <= minMonth}
                onClick={() => go(-1)}
                className={monthButtonClass}
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <span aria-live="polite" className="min-w-36 text-center font-display text-sm tabular-nums">
                {monthLabel(month)}
              </span>
              <button
                type="button"
                aria-label={t("productivity.tracker.monthNext")}
                disabled={month >= currentMonth}
                onClick={() => go(1)}
                className={monthButtonClass}
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
            {/* No habit CRUD exists yet: an honest disabled button, no invented flow. */}
            <button
              type="button"
              disabled
              title={t("productivity.tracker.addHabitSoon")}
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full bg-signal/15 px-4 py-2 font-display text-sm text-signal opacity-60"
            >
              <PlusIcon className="h-4 w-4" />
              {t("productivity.tracker.addHabit")}
            </button>
          </div>
        </div>
      </header>
      <HabitsTrackerGrid habits={habits.data ?? []} monthKey={month} todayYmd={today} />
    </div>
  );
}
