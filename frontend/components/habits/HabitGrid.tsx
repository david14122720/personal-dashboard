"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { isExpected, type DashHabit } from "@/lib/productivity/habitDashboard";

/** One grid row: the pure habit view plus wire-owned presentation metadata. */
export interface HabitGridRow {
  habit: DashHabit;
  color: string | null;
  icon: string | null;
  /** `Categoría • Detalle`; null when the habit has neither. */
  subtitle: string | null;
}

/**
 * Hand-rolled line icons (16) for habit creation and row headers — no icon
 * dependency, same stroke convention as the rest of the deck.
 */
export const HABIT_ICON_NAMES = [
  "run",
  "water",
  "book",
  "dumbbell",
  "brain",
  "moon",
  "sun",
  "meditation",
  "apple",
  "pill",
  "code",
  "pen",
  "music",
  "leaf",
  "flame",
  "target",
] as const;

export type HabitIconName = (typeof HABIT_ICON_NAMES)[number];

function iconPaths(name: HabitIconName): React.ReactNode {
  switch (name) {
    case "run":
      return (
        <>
          <circle cx="12" cy="4.6" r="1.9" />
          <path d="M9.2 8.2l3.2 1.1 2.3-1.6M12.4 9.3l-2.1 3.4 2.6 2.1 1.6 3M10.3 12.7l-3.6 1.1M11 15.8l-1.8 2.6" />
        </>
      );
    case "water":
      return <path d="M10 2.5c2.6 3.2 5.2 6 5.2 9.2a5.2 5.2 0 11-10.4 0C4.8 8.5 7.4 5.7 10 2.5z" />;
    case "book":
      return (
        <>
          <path d="M10 4.8C8.3 3.6 5.9 3.3 3 3.5v11.4c2.9-.2 5.3.1 7 1.3 1.7-1.2 4.1-1.5 7-1.3V3.5c-2.9-.2-5.3.1-7 1.3z" />
          <path d="M10 4.8v11.4" />
        </>
      );
    case "dumbbell":
      return (
        <>
          <path d="M6.5 7v6M13.5 7v6M3.5 8.5v3M16.5 8.5v3M6.5 10h7" />
        </>
      );
    case "brain":
      return (
        <>
          <path d="M10 3.5a3.2 3.2 0 00-3.1 2.4A3 3 0 004 8.7c0 1.2.7 2.2 1.7 2.7a3.1 3.1 0 003.5 4.6" />
          <path d="M10 3.5a3.2 3.2 0 013.1 2.4A3 3 0 0116 8.7c0 1.2-.7 2.2-1.7 2.7a3.1 3.1 0 01-3.5 4.6M10 3.5v12.5" />
        </>
      );
    case "moon":
      return <path d="M15.8 12.4A6.4 6.4 0 017.6 4.2a6.5 6.5 0 108.2 8.2z" />;
    case "sun":
      return (
        <>
          <circle cx="10" cy="10" r="3.4" />
          <path d="M10 2.6v1.7M10 15.7v1.7M2.6 10h1.7M15.7 10h1.7M4.8 4.8l1.2 1.2M14 14l1.2 1.2M15.2 4.8L14 6M6 14l-1.2 1.2" />
        </>
      );
    case "meditation":
      return (
        <>
          <circle cx="10" cy="4.4" r="1.8" />
          <path d="M10 7.4v3.4M6.2 9.6c1.2.9 2.4 1.3 3.8 1.3s2.6-.4 3.8-1.3M4.4 16.2c1.6-1.7 3.5-2.6 5.6-2.6s4 .9 5.6 2.6" />
        </>
      );
    case "apple":
      return (
        <>
          <path d="M12.6 5.2c1.9 0 3.4 1.7 3.4 4.1 0 4.1-2.9 7.2-6 7.2s-6-3.1-6-7.2c0-2.4 1.5-4.1 3.4-4.1 1 0 1.7.5 2.6.5s1.6-.5 2.6-.5z" />
          <path d="M10 5.2c0-1.2.8-2.1 2.1-2.4" />
        </>
      );
    case "pill":
      return (
        <>
          <rect x="3.4" y="7" width="13.2" height="6" rx="3" transform="rotate(-35 10 10)" />
          <path d="M8.2 8.1l3.6 3.6" />
        </>
      );
    case "code":
      return <path d="M7.4 6.8L4.2 10l3.2 3.2M12.6 6.8l3.2 3.2-3.2 3.2M11 5.4l-2 9.2" />;
    case "pen":
      return (
        <>
          <path d="M3.6 16.4l1-3.3 8-8 2.3 2.3-8 8-3.3 1z" />
          <path d="M11.6 6l2.3 2.3" />
        </>
      );
    case "music":
      return (
        <>
          <path d="M8 15V5.8l7-1.4V14" />
          <circle cx="6.2" cy="15" r="1.8" />
          <circle cx="13.2" cy="14" r="1.8" />
        </>
      );
    case "leaf":
      return (
        <>
          <path d="M16.3 3.7C9.2 3.3 4.2 6 4 11.2c-.1 2.5 1.6 4.2 3.7 4.2 4.9 0 8.4-4.9 8.6-11.7z" />
          <path d="M3.5 16.5c3-4.6 6.4-7.4 10.4-9.2" />
        </>
      );
    case "flame":
      return (
        <path d="M10 2.5c.8 3-1.5 4.3-1.5 6.5 0 1.4 1 2.5 2.2 2.5 2 0 2.8-2 2.3-3.7 1.9 1.3 3 3.4 3 5.2 0 3-2.5 5-5.5 5S5 15.9 5 13c0-3.5 3.5-5.5 5-10.5z" />
      );
    case "target":
    default:
      return (
        <>
          <circle cx="10" cy="10" r="6.6" />
          <circle cx="10" cy="10" r="4" />
          <circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none" />
        </>
      );
  }
}

/** One habit icon by name; unknown names fall back to the target icon. */
export function HabitIcon({ name, className }: { name: string | null; className?: string }) {
  const key = (HABIT_ICON_NAMES as readonly string[]).includes(name ?? "") ? (name as HabitIconName) : "target";
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {iconPaths(key)}
    </svg>
  );
}

/** `12 de octubre` for a local `YYYY-MM-DD` date (Spanish month names). */
export function dayLabelEs(date: string): string {
  const parts = date.split("-").map(Number);
  if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) return date;
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])));
}

function tint(color: string | null): { style?: React.CSSProperties; className: string } {
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
    return { style: { backgroundColor: `${color}33`, color }, className: "" };
  }
  return { className: "bg-signal/15 text-signal" };
}

const cellBase =
  "flex h-[30px] w-[30px] items-center justify-center rounded-md font-mono text-[11px] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal";

export interface HabitGridProps {
  rows: HabitGridRow[];
  days: string[];
  /** Visible month (`YYYY-MM`); re-runs the today auto-scroll on month change. */
  monthKey: string;
  todayYmd: string;
  isDone: (habitId: string, date: string) => boolean;
  onToggle: (habitId: string, date: string) => void;
  onArchive: (habitId: string) => void;
}

/**
 * Month grid: one row per habit, one 30×30 button per day. Past/today cells
 * toggle (optimistic, owned by the container), future/off-range/off-schedule
 * cells are disabled. The left column is sticky and the grid scrolls
 * horizontally; the today column scrolls into view whenever the month changes.
 */
export default function HabitGrid({ rows, days, monthKey, todayYmd, isDone, onToggle, onArchive }: HabitGridProps) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const todayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = todayRef.current;
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ inline: "center", block: "nearest" });
    }
  }, [monthKey, todayYmd, days.length, rows.length]);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuFor(null);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

  const gridTitle = t("habitsDashboard.title");

  return (
    <div className="overflow-x-auto pb-1">
      <div
        role="grid"
        aria-label={gridTitle}
        className="grid w-max min-w-full gap-x-1 gap-y-1.5"
        style={{ gridTemplateColumns: `300px repeat(${days.length}, 30px)` }}
      >
        <div role="row" className="contents">
          <div
            role="columnheader"
            className="sticky left-0 z-20 flex h-8 items-center bg-deck px-2 font-display text-[11px] uppercase tracking-widest text-instrument/50"
          >
            {t("habitsDashboard.colHabit")}
          </div>
          {days.map((date) => {
            const isToday = date === todayYmd;
            return (
              <div
                key={date}
                ref={isToday ? todayRef : undefined}
                role="columnheader"
                aria-label={dayLabelEs(date)}
                aria-current={isToday ? "date" : undefined}
                className={`flex h-8 items-center justify-center font-mono text-[10px] tabular-nums ${
                  isToday ? "rounded bg-signal/15 font-semibold text-signal" : "text-instrument/45"
                }`}
              >
                {date.slice(8)}
              </div>
            );
          })}
        </div>

        {rows.map((row) => {
          const habit = row.habit;
          const badge = tint(row.color);
          return (
            <div key={habit.id} role="row" aria-label={habit.name} className="contents">
              <div
                role="rowheader"
                className="group sticky left-0 z-10 flex h-10 items-center gap-3 overflow-visible bg-deck px-2"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${badge.className}`}
                  style={badge.style}
                >
                  <HabitIcon name={row.icon} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-instrument">{habit.name}</span>
                  {row.subtitle ? (
                    <span className="block truncate text-[11px] text-instrument/50">{row.subtitle}</span>
                  ) : null}
                </span>
                <span className="relative shrink-0">
                  <button
                    type="button"
                    aria-label={t("habitsDashboard.rowMenu", { name: habit.name })}
                    aria-haspopup="menu"
                    aria-expanded={menuFor === habit.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuFor((prev) => (prev === habit.id ? null : habit.id));
                    }}
                    className="rounded-md px-1.5 py-1 text-instrument/50 opacity-0 transition-opacity hover:text-signal focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    ⋯
                  </button>
                  {menuFor === habit.id ? (
                    <span
                      role="menu"
                      className="absolute right-0 top-8 z-30 w-36 rounded-lg border border-hull bg-deck p-1 shadow-lg"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuFor(null);
                          onArchive(habit.id);
                        }}
                        className="block w-full rounded-md px-3 py-1.5 text-left text-xs text-instrument transition-colors hover:bg-hull/60 hover:text-signal"
                      >
                        {t("habitsDashboard.archive")}
                      </button>
                    </span>
                  ) : null}
                </span>
              </div>
              {days.map((date) => {
                const scheduled = isExpected(habit, date, todayYmd);
                const done = isDone(habit.id, date);
                const isToday = date === todayYmd;
                const status = !scheduled
                  ? date > todayYmd
                    ? t("habitsDashboard.cellFuture")
                    : t("habitsDashboard.cellUnscheduled")
                  : done
                    ? t("habitsDashboard.cellDone")
                    : t("habitsDashboard.cellPending");
                const label = t("habitsDashboard.cellLabel", {
                  name: habit.name,
                  date: dayLabelEs(date),
                  status,
                });
                const stateClass = done
                  ? "bg-signal text-white hover:bg-signal/90"
                  : scheduled
                    ? `bg-hull/60 text-instrument/60 hover:bg-hull ${isToday ? "ring-1 ring-signal" : ""}`
                    : "bg-black/40 text-instrument/20";
                return (
                  <button
                    key={date}
                    type="button"
                    role="gridcell"
                    aria-label={label}
                    aria-pressed={done}
                    title={label}
                    disabled={!scheduled}
                    onClick={() => onToggle(habit.id, date)}
                    className={`${cellBase} ${stateClass} ${scheduled ? "cursor-pointer" : "cursor-default"}`}
                  >
                    {done ? (
                      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
                        <path
                          d="M5 10.4l3 3 7-7.4"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
