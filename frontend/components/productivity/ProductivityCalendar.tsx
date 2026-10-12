"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSWRConfig } from "swr";
import DashboardDisclosure from "@/components/dashboard/DashboardDisclosure";
import EmptyState from "@/components/ui/EmptyState";
import { deck } from "@/components/ui/deckStyles";
import { formatMonth, t, type EsKey } from "@/lib/i18n";
import {
  TASKS_KEY,
  eventsKey,
  useEvents,
  useTasks,
  type EventWire,
  type TaskWire,
} from "@/lib/api/productivity";
import { toEventRange } from "@/lib/finance/finance";
import {
  calendarDateLabel,
  dayEntries,
  eventWhenLabel,
  monthGridCells,
  monthGridRange,
  shiftMonth,
  todayYmdLocal,
  type CalendarDayCell,
} from "@/lib/productivity/productivity";

const CALENDAR_PANEL_ID = "productivity-calendar-panel";
const DAY_PANEL_ID = "productivity-calendar-day-panel";

/**
 * Monthly productivity calendar: the prototype's collapsible telemetry block
 * (`productividad-desktop-v2.html:46`). It keeps the real 42-cell Monday-first
 * month grid, the real reads (`GET /tasks` + `GET /events` over the visible
 * range) and the one-day detail region, and restyles the title block, the
 * legend and the day cells to the prototype's language.
 *
 * The module header owns the toggle when the component is controlled
 * (`open` + `onToggle`); standalone usage (tests, other surfaces) keeps the
 * internal `DashboardDisclosure` trigger and its `Calendario` heading.
 *
 * The prototype's `Hábitos` legend dot is deliberately not rendered: this
 * surface reads no habit data (Hábitos has its own module), so claiming a
 * habit series here would be an invented indicator.
 */

export interface ProductivityCalendarProps {
  /** Controlled disclosure state; only honored together with `onToggle`. */
  open?: boolean;
  onToggle?: () => void;
}

interface DayEntryRows {
  tasks: TaskWire[];
  events: EventWire[];
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <rect height="18" rx="2" ry="2" width="18" x="3" y="4" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function ChevronIcon({ direction, className }: { direction: "left" | "right"; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      {direction === "left" ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 6l6 6-6 6" />}
    </svg>
  );
}

function taskStatusText(status: string): string {
  if (status === "in_progress") return t("productivity.taskStatusInProgress");
  if (status === "completed") return t("productivity.taskStatusCompleted");
  if (status === "cancelled") return t("productivity.taskStatusCancelled");
  if (status === "pending") return t("productivity.taskStatusPending");
  return status;
}

function taskPriorityText(priority: string): string {
  if (priority === "urgent") return t("productivity.taskPriorityUrgent");
  if (priority === "high") return t("productivity.taskPriorityHigh");
  if (priority === "medium") return t("productivity.taskPriorityMedium");
  if (priority === "low") return t("productivity.taskPriorityLow");
  return priority;
}

function eventKindText(kind: string): string {
  if (kind === "appointment") return t("productivity.eventKindAppointment");
  if (kind === "reminder") return t("productivity.eventKindReminder");
  if (kind === "payment_due") return t("productivity.eventKindPaymentDue");
  if (kind === "goal_milestone") return t("productivity.eventKindGoalMilestone");
  if (kind === "habit_reminder") return t("productivity.eventKindHabitReminder");
  if (kind === "event") return t("productivity.eventKindEvent");
  return kind;
}

/** Spanish count phrase with singular/plural keys (i18n has no plural engine). */
function countText(count: number, oneKey: EsKey, manyKey: EsKey): string {
  return count === 1 ? t(oneKey) : t(manyKey, { n: count });
}

/** Accessible cell name, e.g. «15 de octubre: 2 tareas, 1 evento». */
function cellSummary(date: string, taskCount: number, eventCount: number): string {
  const dateLabel = calendarDateLabel(date);
  const parts: string[] = [];
  if (taskCount > 0) parts.push(countText(taskCount, "productivity.calendarTasksOne", "productivity.calendarTasksMany"));
  if (eventCount > 0) parts.push(countText(eventCount, "productivity.calendarEventsOne", "productivity.calendarEventsMany"));
  if (parts.length === 0) return t("productivity.calendarDayEmptyLabel", { date: dateLabel });
  return t("productivity.calendarDayLabel", { date: dateLabel, summary: parts.join(", ") });
}

/**
 * ISO-8601 week number (1-53) of a local `YYYY-MM-DD`; null when the date is
 * invalid. Used for the title-block subline (`Semana 41 · Telemetría
 * semanal`), always from a real date of the visible month — never fabricated.
 */
export function isoWeekNumber(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(target)) return null;
  const DAY_MS = 86_400_000;
  const mondayOffset = (new Date(target).getUTCDay() + 6) % 7; // Monday = 0
  const thursday = target + (3 - mondayOffset) * DAY_MS;
  const yearStart = Date.UTC(new Date(thursday).getUTCFullYear(), 0, 4);
  const yearStartOffset = (new Date(yearStart).getUTCDay() + 6) % 7;
  const firstThursday = yearStart + (3 - yearStartOffset) * DAY_MS;
  return Math.round((thursday - firstThursday) / (7 * DAY_MS)) + 1;
}

export default function ProductivityCalendar({
  open: controlledOpen,
  onToggle: controlledToggle,
}: ProductivityCalendarProps = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const controlled = controlledOpen !== undefined && controlledToggle !== undefined;
  const open = controlled ? controlledOpen : uncontrolledOpen;
  const toggle = controlled ? (controlledToggle as () => void) : () => setUncontrolledOpen((value) => !value);

  if (controlled) {
    // The header owns both the toggle and the visual shell: while collapsed the
    // block renders nothing but the hidden panel target its `aria-controls`
    // points at, so the page shows no empty calendar box.
    return (
      <div id={CALENDAR_PANEL_ID} hidden={!open}>
        {open ? (
          <section className={deck.calendarPanel}>
            <ProductivityCalendarBody />
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="col-span-12">
      <DashboardDisclosure
        title={t("productivity.calendarTitle")}
        hint={t("productivity.calendarHint")}
        open={open}
        onToggle={toggle}
        panelId={CALENDAR_PANEL_ID}
      >
        <ProductivityCalendarBody />
      </DashboardDisclosure>
    </div>
  );
}

function ProductivityCalendarBody() {
  const { mutate } = useSWRConfig();
  const [monthKey, setMonthKey] = useState(() => todayYmdLocal().slice(0, 7));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());

  const cells = useMemo(() => monthGridCells(monthKey), [monthKey]);
  const range = useMemo(() => monthGridRange(monthKey), [monthKey]);
  // The grid bounds are local days but the API query is UTC: a one-day
  // margin on both edges keeps every event the client-side local bucketing
  // can place on a visible day (see `toEventRange`).
  const eventRange = useMemo(
    () => (range.from && range.to ? toEventRange(range, 1) : { from: null, to: null }),
    [range],
  );
  const tasks = useTasks();
  const events = useEvents(eventRange.from, eventRange.to);
  const taskRows = tasks.data ?? [];
  const eventRows = events.data ?? [];
  const isLoading = tasks.isLoading || events.isLoading;
  const failed = Boolean(tasks.error || events.error);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, DayEntryRows>();
    for (const cell of cells) map.set(cell.date, dayEntries(taskRows, eventRows, cell.date));
    return map;
  }, [cells, taskRows, eventRows]);
  const monthHasEntries = useMemo(
    () => [...entriesByDate.values()].some((entries) => entries.tasks.length > 0 || entries.events.length > 0),
    [entriesByDate],
  );
  const weeks = useMemo(() => {
    const rows: CalendarDayCell[][] = [];
    for (let index = 0; index < cells.length; index += 7) rows.push(cells.slice(index, index + 7));
    return rows;
  }, [cells]);
  const weekdays = useMemo(() => t("productivity.calendarWeekdays").split(","), []);

  // Real week of the title block: the selected day when there is one, today
  // when the visible month holds it, and otherwise the month's first day.
  const weekReference = useMemo(() => {
    const today = todayYmdLocal();
    if (selectedDate) return selectedDate;
    if (today.slice(0, 7) === monthKey) return today;
    return cells.find((cell) => cell.inMonth)?.date ?? "";
  }, [cells, monthKey, selectedDate]);
  const weekNumber = useMemo(() => isoWeekNumber(weekReference), [weekReference]);

  useEffect(() => {
    if (selectedDate) panelRef.current?.focus({ preventScroll: true });
  }, [selectedDate]);

  function goToMonth(delta: number): void {
    setMonthKey((current) => shiftMonth(current, delta));
    setSelectedDate(null);
  }

  function goToToday(): void {
    setMonthKey(todayYmdLocal().slice(0, 7));
    setSelectedDate(null);
  }

  function retry(): void {
    void mutate(TASKS_KEY);
    void mutate(eventsKey(eventRange.from, eventRange.to));
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== "Escape" || !selectedDate) return;
    const date = selectedDate;
    setSelectedDate(null);
    cellRefs.current.get(date)?.focus({ preventScroll: true });
  }

  const selectedEntries = selectedDate ? entriesByDate.get(selectedDate) ?? { tasks: [], events: [] } : null;

  return (
    <div className="flex flex-col gap-4">
      <div className={deck.calendarHeader}>
        <div className="flex min-w-0 items-center gap-2">
          <span className={deck.calendarIconTile}>
            <CalendarIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p aria-live="polite" className={deck.calendarTitle}>
              {formatMonth(monthKey)}
            </p>
            <span className={deck.calendarTelemetry}>
              {weekNumber === null
                ? t("productivity.calendarTelemetryOnly")
                : t("productivity.calendarWeekTelemetry", { n: weekNumber })}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ul aria-label={t("productivity.calendarLegendLabel")} className={deck.calendarLegend}>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className={deck.calendarLegendDotTask} />
              {t("productivity.tasks")}
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className={deck.calendarLegendDotEvent} />
              {t("productivity.events")}
            </li>
          </ul>
          <div className={deck.calendarNavGroup}>
            <button
              type="button"
              aria-label={t("productivity.calendarPrev")}
              onClick={() => goToMonth(-1)}
              className={deck.calendarNavButton}
            >
              <ChevronIcon direction="left" className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goToToday}
              className={`${deck.calendarNavButton} px-3 text-xs`}
            >
              {t("productivity.calendarToday")}
            </button>
            <button
              type="button"
              aria-label={t("productivity.calendarNext")}
              onClick={() => goToMonth(1)}
              className={deck.calendarNavButton}
            >
              <ChevronIcon direction="right" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <p role="status" className="text-xs text-muted">
          {t("common.loading")}
        </p>
      ) : null}
      {failed ? (
        <div role="alert" className="rounded-lg border border-alert/50 bg-alert/10 p-3">
          <p className="font-display text-sm font-semibold">{t("productivity.calendarLoadFailed")}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-2 min-h-[44px] rounded-lg border border-hair px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            {t("common.retry")}
          </button>
        </div>
      ) : null}
      {!isLoading && !failed && !monthHasEntries ? (
        <EmptyState title={t("productivity.calendarEmptyMonth")} />
      ) : null}

      <div
        role="grid"
        aria-label={formatMonth(monthKey)}
        aria-colcount={7}
        aria-rowcount={weeks.length + 1}
        className="grid grid-cols-7 gap-0.5 sm:gap-1"
      >
        <div role="row" className="contents">
          {weekdays.map((weekday) => (
            <span
              key={weekday}
              role="columnheader"
              aria-label={weekday}
              className="flex min-h-[24px] items-center justify-center whitespace-nowrap font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-faint"
            >
              {weekday}
            </span>
          ))}
        </div>
        {weeks.map((week, weekIndex) => (
          <div role="row" key={`week-${weekIndex}`} className="contents">
            {week.map((cell) => {
              const entries = entriesByDate.get(cell.date) ?? { tasks: [], events: [] };
              const taskCount = entries.tasks.length;
              const eventCount = entries.events.length;
              const selected = selectedDate === cell.date;
              return (
                <button
                  key={cell.date}
                  ref={(node) => {
                    if (node) cellRefs.current.set(cell.date, node);
                    else cellRefs.current.delete(cell.date);
                  }}
                  type="button"
                  role="gridcell"
                  aria-label={cellSummary(cell.date, taskCount, eventCount)}
                  aria-current={cell.isToday ? "date" : undefined}
                  aria-expanded={selected}
                  aria-controls={DAY_PANEL_ID}
                  onClick={() => setSelectedDate((current) => (current === cell.date ? null : cell.date))}
                  className={`${deck.calendarCell} ${cell.inMonth ? "text-instrument" : "text-instrument/40"} ${
                    selected ? "border-signal bg-signal/10" : "border-hair hover:border-hair-strong hover:bg-card-hover"
                  } ${cell.isToday ? deck.calendarCellToday : ""}`}
                >
                  <span className="font-mono text-xs tabular-nums sm:text-sm">{Number(cell.date.slice(8))}</span>
                  {taskCount > 0 || eventCount > 0 ? (
                    <span className={deck.calendarCellMarkers}>
                      {taskCount > 0 ? (
                        <span data-marker="task" className={`${deck.calendarMarker} text-signal`}>
                          <span aria-hidden="true" className={deck.calendarLegendDotTask} />
                          <span className={deck.calendarMarkerCount}>{taskCount}</span>
                        </span>
                      ) : null}
                      {eventCount > 0 ? (
                        <span data-marker="event" className={`${deck.calendarMarker} text-signal-soft`}>
                          <span aria-hidden="true" className={deck.calendarLegendDotEvent} />
                          <span className={deck.calendarMarkerCount}>{eventCount}</span>
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div
        id={DAY_PANEL_ID}
        ref={panelRef}
        hidden={!selectedDate}
        tabIndex={-1}
        role="region"
        aria-label={
          selectedDate
            ? t("productivity.calendarDayDetail", { date: calendarDateLabel(selectedDate) })
            : undefined
        }
        onKeyDown={handlePanelKeyDown}
        className="animate-fade-in rounded-xl border border-hair bg-card/60 p-4 transition-opacity motion-reduce:animate-none motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
      >
        {selectedDate && selectedEntries ? (
          <DayDetail entries={selectedEntries} />
        ) : null}
      </div>
    </div>
  );
}

function DayDetail({ entries }: { entries: DayEntryRows }) {
  if (entries.tasks.length === 0 && entries.events.length === 0) {
    return <EmptyState title={t("productivity.calendarEmptyDay")} hint={t("productivity.calendarEmptyDayHint")} />;
  }
  return (
    <div className="flex flex-col gap-4">
      {entries.tasks.length > 0 ? (
        <div>
          <h4 className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-faint">
            {t("productivity.tasks")}
          </h4>
          <ul className="mt-2 flex flex-col gap-2">
            {entries.tasks.map((task) => (
              <li key={task.id} className="rounded-lg border border-hair bg-panel/60 px-3 py-2">
                <p className="text-sm">{task.title}</p>
                <p className="text-xs text-muted">
                  {`${taskPriorityText(task.priority)} · ${taskStatusText(task.status)}`}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {entries.events.length > 0 ? (
        <div>
          <h4 className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-faint">
            {t("productivity.events")}
          </h4>
          <ul className="mt-2 flex flex-col gap-2">
            {entries.events.map((event) => (
              <li key={event.id} className="rounded-lg border border-hair bg-panel/60 px-3 py-2">
                <p className="text-sm">{event.title}</p>
                <p className="text-xs text-muted">
                  {`${eventKindText(event.kind)} · ${eventWhenLabel(event.starts_at, event.all_day)}`}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
