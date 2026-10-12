"use client";

import { useEffect, useRef, useState } from "react";
import { t, type EsKey } from "@/lib/i18n";
import { deck } from "@/components/ui/deckStyles";

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

/** Full Spanish weekday names for the best-day footer (Monday-first). */
const WEEKDAY_LONG_KEYS: EsKey[] = [
  "habitsDashboard.weekdayLongMon",
  "habitsDashboard.weekdayLongTue",
  "habitsDashboard.weekdayLongWed",
  "habitsDashboard.weekdayLongThu",
  "habitsDashboard.weekdayLongFri",
  "habitsDashboard.weekdayLongSat",
  "habitsDashboard.weekdayLongSun",
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
 * Weekly consistency card (`habitos-desktop.html` L697-806 /
 * `habitos-mobile.html` L603-684): 7 Monday-first bars fed by the real
 * per-weekday compliance of the visible month (in-proportion heights with a
 * visible minimum), % above, weekday below, average badge and the detailed
 * per-habit report modal that the prototype's `Ver reporte detallado`
 * actually opens (no dead link).
 */
export default function WeeklyChart({ values, avg, best, weeks, monthLabel, report }: WeeklyChartProps) {
  const [reportOpen, setReportOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!reportOpen) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = (): HTMLElement[] =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Sibling document listeners (other modals, app shortcuts) must not
        // also react to the same Esc press.
        event.stopImmediatePropagation();
        setReportOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      triggerRef.current?.focus();
    };
  }, [reportOpen]);

  // Pull focus back into the panel if it escapes while the report is open
  // (mirrors the create-modal containment guard).
  useEffect(() => {
    if (!reportOpen) return;
    const onFocusIn = (event: FocusEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (event.target instanceof Node && panel.contains(event.target)) return;
      closeRef.current?.focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [reportOpen]);

  const min = Math.min(...values);
  const lowest = values.length > 0 ? values.indexOf(min) : -1;
  const bestDay = t(WEEKDAY_LONG_KEYS[best.index] ?? "habitsDashboard.weekdayLongMon");

  return (
    <section aria-label={t("habitsDashboard.weeklyTitle")} className={deck.panel}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarsIcon className="h-5 w-5 shrink-0 text-signal" />
          <h2 className="text-headline-md font-semibold text-instrument">{t("habitsDashboard.weeklyTitle")}</h2>
        </div>
        <span className={deck.weeklyAveragePill}>
          {t("habitsDashboard.weeklyAverage", { n: Math.round(avg) })}
        </span>
      </div>
      <p className="mt-1 text-body-sm text-muted">
        {t("habitsDashboard.weeklyHint", { n: weeks, month: monthLabel })}
      </p>

      <div className="mt-5 grid grid-cols-7 items-end gap-1.5 sm:gap-3">
        {WEEKDAY_KEYS.map((key, index) => {
          const pct = values[index] ?? 0;
          return (
            <div key={key} className="flex min-w-0 flex-col items-center gap-2">
              <span className="font-mono text-[11px] tabular-nums text-muted">{Math.round(pct)}%</span>
              <div className="flex h-32 w-full items-end justify-center sm:h-36">
                <div className={deck.weeklyBarTrack} style={{ height: `${Math.max(pct, 4)}%` }}>
                  <span
                    aria-hidden="true"
                    className={`${deck.weeklyBarFill}${index === lowest ? " opacity-40" : ""}`}
                  />
                </div>
              </div>
              <span className="text-label-md font-semibold text-instrument">{t(key)}</span>
            </div>
          );
        })}
      </div>

      <div className={deck.weeklyFooterRow}>
        <p className="text-body-sm text-muted">
          {t("habitsDashboard.weeklyBestDayPre")}
          <strong className="font-semibold text-instrument">
            {t("habitsDashboard.weeklyBestDayBold", { day: bestDay, pct: Math.round(best.pct) })}
          </strong>
          {t("habitsDashboard.weeklyBestDayPost")}
        </p>
        <button ref={triggerRef} type="button" onClick={() => setReportOpen(true)} className={deck.cardFooterLink}>
          {t("habitsDashboard.viewReport")}
        </button>
      </div>

      {reportOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-deck/80 p-4 backdrop-blur-sm"
          onClick={(event) => {
            if (event.target === event.currentTarget) setReportOpen(false);
          }}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="habit-report-title"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-hair bg-card p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4">
              <h3 id="habit-report-title" className="font-deck-display text-lg font-bold text-instrument">
                {t("habitsDashboard.reportTitle")}
              </h3>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setReportOpen(false)}
                className={deck.headerAction}
              >
                {t("habitsDashboard.reportClose")}
              </button>
            </div>
            <table className="mt-4 w-full border-collapse text-left text-xs">
              <thead>
                <tr className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
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
                  <tr key={row.id} className="border-t border-hair text-muted">
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
