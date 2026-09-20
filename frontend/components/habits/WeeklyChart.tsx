"use client";

import { useEffect, useRef, useState } from "react";
import { t, type EsKey } from "@/lib/i18n";

/** One report-table row for the five-column summary modal. */
export interface HabitReportRow {
  id: string;
  name: string;
  monthPct: number;
  doneDays: number;
  currentStreak: number;
  maxStreak: number;
}

const WEEKDAY_KEYS: EsKey[] = [
  "habitsDashboard.weekdayMon",
  "habitsDashboard.weekdayTue",
  "habitsDashboard.weekdayWed",
  "habitsDashboard.weekdayThu",
  "habitsDashboard.weekdayFri",
  "habitsDashboard.weekdaySat",
  "habitsDashboard.weekdaySun",
];

export interface WeeklyChartProps {
  /** Monday-first percentages (7 entries). */
  values: number[];
  avg: number;
  best: { index: number; pct: number };
  /** Weeks the visible month spans (`N` in the hint sentence). */
  weeks: number;
  monthLabel: string;
  report: HabitReportRow[];
}

function BarsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M4 16V9M10 16V4M16 16v-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Weekly consistency card: 7 Monday-first bars (in-proportion heights with a
 * visible minimum), % above, weekday below, average badge and a detailed
 * per-habit report modal.
 */
export default function WeeklyChart({ values, avg, best, weeks, monthLabel, report }: WeeklyChartProps) {
  const [reportOpen, setReportOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!reportOpen) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReportOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [reportOpen]);

  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const lowest = max > min ? values.indexOf(min) : -1;
  const bestDay = t(WEEKDAY_KEYS[best.index] ?? "habitsDashboard.weekdayMon");

  return (
    <section
      aria-label={t("habitsDashboard.weeklyTitle")}
      className="rounded-2xl border border-white/5 bg-gradient-to-b from-hull/40 to-deck/60 p-[22px]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarsIcon className="h-4 w-4 text-signal" />
          <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-instrument">
            {t("habitsDashboard.weeklyTitle")}
          </h2>
        </div>
        <span className="rounded-full border border-signal/30 bg-signal/10 px-3 py-0.5 font-display text-[11px] uppercase tracking-widest text-signal">
          {t("habitsDashboard.weeklyAverage", { n: Math.round(avg) })}
        </span>
      </div>
      <p className="mt-1 text-xs text-instrument/50">
        {t("habitsDashboard.weeklyHint", { n: weeks, month: monthLabel })}
      </p>

      <div className="mt-5 flex items-end gap-2 sm:gap-3">
        {WEEKDAY_KEYS.map((key, index) => {
          const pct = values[index] ?? 0;
          return (
            <div key={key} className="flex flex-1 flex-col items-center gap-2">
              <span className="font-mono text-[11px] tabular-nums text-instrument/70">{Math.round(pct)}%</span>
              <div className="flex h-32 w-full items-end justify-center">
                <div
                  aria-hidden="true"
                  className={`h-full w-full max-w-14 rounded-t-md transition-all ${index === lowest ? "opacity-40" : ""}`}
                  style={{
                    height: `${Math.max(pct, 4)}%`,
                    background: "linear-gradient(to top, #4F7CFF, #38BDF8)",
                  }}
                />
              </div>
              <span className="font-display text-[11px] uppercase tracking-wider text-instrument/50">{t(key)}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-4 text-xs text-instrument/60">
        <p>{t("habitsDashboard.weeklyBestDay", { day: bestDay, pct: Math.round(best.pct) })}</p>
        <button
          type="button"
          onClick={() => setReportOpen(true)}
          className="font-display text-xs text-signal transition-colors hover:text-flow"
        >
          {t("habitsDashboard.viewReport")}
        </button>
      </div>

      {reportOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setReportOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="habit-report-title"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/5 bg-gradient-to-b from-hull/40 to-deck/60 p-[22px] shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4">
              <h3 id="habit-report-title" className="font-deck-display text-lg font-bold text-instrument">
                {t("habitsDashboard.reportTitle")}
              </h3>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setReportOpen(false)}
                className="rounded-md border border-hull px-3 py-1 font-display text-xs text-instrument transition-colors hover:border-signal hover:text-signal"
              >
                {t("habitsDashboard.reportClose")}
              </button>
            </div>
            <table className="mt-4 w-full border-collapse text-left text-xs">
              <thead>
                <tr className="font-display text-[11px] uppercase tracking-widest text-instrument/50">
                  <th scope="col" className="py-2 pr-3">
                    {t("habitsDashboard.reportHabit")}
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    {t("habitsDashboard.reportMonth")}
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    {t("habitsDashboard.reportDoneDays")}
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    {t("habitsDashboard.reportCurrentStreak")}
                  </th>
                  <th scope="col" className="py-2">
                    {t("habitsDashboard.reportMaxStreak")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.map((row) => (
                  <tr key={row.id} className="border-t border-white/5 text-instrument/80">
                    <td className="py-2 pr-3 font-medium text-instrument">{row.name}</td>
                    <td className="py-2 pr-3 font-mono tabular-nums">{`${row.monthPct}%`}</td>
                    <td className="py-2 pr-3 font-mono tabular-nums">{row.doneDays}</td>
                    <td className="py-2 pr-3 font-mono tabular-nums">{row.currentStreak}</td>
                    <td className="py-2 font-mono tabular-nums">{row.maxStreak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
