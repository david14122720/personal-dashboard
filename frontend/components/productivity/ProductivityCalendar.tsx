"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSWRConfig } from "swr";
import DashboardDisclosure from "@/components/dashboard/DashboardDisclosure";
import EmptyState from "@/components/ui/EmptyState";
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

const navButtonClass =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-hull px-2 font-display text-sm transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal";

// Cells flex to the column width: `min-w-0` lets seven columns plus six gaps
// fit a 375px viewport, while `min-h-[44px]` keeps the thumb target (design.md
// "Mobile geometry").
const cellClass =
  "flex min-h-[44px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-md border px-1 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal";

interface DayEntryRows {
  tasks: TaskWire[];
  events: EventWire[];
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
 * Monthly productivity calendar: a collapsed-by-default `DashboardDisclosure`
 * whose panel holds a Monday-first 42-cell grid (tasks by `due_date`, events
 * by day overlap), prev/next/«Hoy» navigation and a one-day detail region.
 * Only the CalendarBody is mounted while the disclosure is open, so the
 * collapsed block issues no reads.
 */
export default function ProductivityCalendar() {
  const [open, setOpen] = useState(false);
  return (
    <div className="col-span-12">
      <DashboardDisclosure
        title={t("productivity.calendarTitle")}
        hint={t("productivity.calendarHint")}
        open={open}
        onToggle={() => setOpen((value) => !value)}
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p aria-live="polite" className="font-display text-sm font-semibold text-instrument">
          {formatMonth(monthKey)}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t("productivity.calendarPrev")}
            onClick={() => goToMonth(-1)}
            className={navButtonClass}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            aria-label={t("productivity.calendarNext")}
            onClick={() => goToMonth(1)}
            className={navButtonClass}
          >
            <span aria-hidden="true">›</span>
          </button>
          <button type="button" onClick={goToToday} className={`${navButtonClass} px-3 text-xs`}>
            {t("productivity.calendarToday")}
          </button>
        </div>
      </div>

      {isLoading ? (
        <p role="status" className="text-xs text-instrument/60">
          {t("common.loading")}
        </p>
      ) : null}
      {failed ? (
        <div role="alert" className="rounded-lg border border-alert/50 bg-alert/10 p-3">
          <p className="font-display text-sm font-semibold">{t("productivity.calendarLoadFailed")}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-2 min-h-[44px] rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
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
              className="flex min-h-[24px] items-center justify-center font-display text-[11px] font-semibold uppercase tracking-wide text-instrument/50"
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
                  aria-expanded={selected}
                  aria-controls={DAY_PANEL_ID}
                  onClick={() => setSelectedDate((current) => (current === cell.date ? null : cell.date))}
                  className={`${cellClass} ${cell.inMonth ? "text-instrument" : "text-instrument/40"} ${
                    selected ? "border-signal bg-signal/10" : "border-hull/60 hover:border-hull"
                  } ${cell.isToday ? "ring-2 ring-signal" : ""}`}
                >
                  <span className="font-mono text-xs tabular-nums sm:text-sm">{Number(cell.date.slice(8))}</span>
                  {taskCount > 0 || eventCount > 0 ? (
                    <span className="flex flex-wrap items-center justify-center gap-1 leading-none">
                      {taskCount > 0 ? (
                        <span data-marker="task" className="inline-flex items-center gap-0.5 text-flow">
                          <span aria-hidden="true" className="h-2 w-2 bg-flow" />
                          <span className="font-mono text-[11px] tabular-nums">{taskCount}</span>
                        </span>
                      ) : null}
                      {eventCount > 0 ? (
                        <span data-marker="event" className="inline-flex items-center gap-0.5 text-signal">
                          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-signal" />
                          <span className="font-mono text-[11px] tabular-nums">{eventCount}</span>
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
        className="animate-fade-in rounded-lg border border-hull bg-deck/60 p-4 transition-opacity motion-reduce:animate-none motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
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
          <h4 className="font-display text-xs font-semibold uppercase tracking-widest text-instrument/50">
            {t("productivity.tasks")}
          </h4>
          <ul className="mt-2 flex flex-col gap-2">
            {entries.tasks.map((task) => (
              <li key={task.id} className="rounded-md border border-hull px-3 py-2">
                <p className="text-sm">{task.title}</p>
                <p className="text-xs text-instrument/60">
                  {`${taskPriorityText(task.priority)} · ${taskStatusText(task.status)}`}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {entries.events.length > 0 ? (
        <div>
          <h4 className="font-display text-xs font-semibold uppercase tracking-widest text-instrument/50">
            {t("productivity.events")}
          </h4>
          <ul className="mt-2 flex flex-col gap-2">
            {entries.events.map((event) => (
              <li key={event.id} className="rounded-md border border-hull px-3 py-2">
                <p className="text-sm">{event.title}</p>
                <p className="text-xs text-instrument/60">
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
