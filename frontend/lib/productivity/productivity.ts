/**
 * Productivity transform boundary. Pure helpers for the productivity
 * screens — containers own SWR reads, UI components receive these views.
 */

export type HeatCell = "done" | "missed" | "pending" | "empty";

/**
 * Map a `today_status` (done|missed|skipped|pending) to the shared LED dot
 * key. `done` glows flow, `pending` warns signal, `missed` alerts; `skipped`
 * is neutral (no LED) because skipped days bridge streaks without counting.
 */
export function habitStatusLed(status: string | null | undefined): "ok" | "warn" | "over" | null {
  switch (status) {
    case "done":
      return "ok";
    case "pending":
      return "warn";
    case "missed":
      return "over";
    default:
      return null;
  }
}

export interface TaskGroup {
  status: string;
  items: Array<{ id: string } & Record<string, unknown>>;
}

export const TASK_GROUP_ORDER = ["pending", "in_progress", "completed", "cancelled"] as const;

/** Group tasks by `status` in a stable, spec-known order. */
export function groupTasksByStatus<T extends { id: string; status: string }>(
  tasks: T[] | null | undefined,
): Array<{ status: string; items: T[] }> {
  if (!tasks) return [];
  const groups = new Map<string, T[]>();
  for (const task of tasks) {
    const list = groups.get(task.status) ?? [];
    list.push(task);
    groups.set(task.status, list);
  }
  const ordered: Array<{ status: string; items: T[] }> = [];
  for (const status of TASK_GROUP_ORDER) {
    const items = groups.get(status);
    if (items) {
      ordered.push({ status, items });
      groups.delete(status);
    }
  }
  for (const [status, items] of groups) {
    ordered.push({ status, items });
  }
  return ordered;
}

/** Clamp trigger-owned goal `progress` (0-100) to a 0-1 fraction. */
export function goalProgressFraction(progress: number | null | undefined): number {
  if (!Number.isFinite(progress ?? NaN)) return 0;
  return Math.min(1, Math.max(0, (progress as number) / 100));
}

/** Compact label for an event start (`7 sept, 10:30` or `7 sept` all-day). Spanish only. */
export function eventWhenLabel(startsAt: string, allDay: boolean): string {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return startsAt;
  const day = date.toLocaleDateString("es", { month: "short", day: "numeric" });
  if (allDay) return `${day} · todo el día`;
  const time = date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

/** Single-line excerpt of a note body for the results list. */
export function noteExcerpt(body: string | null | undefined, max: number = 140): string {
  if (!body) return "";
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

/* -- S2 (Hoy accionable): vistas por fecha + opciones de formularios -- */

/** Priorities accepted by `POST /tasks` (backend `task_priority` enum). */
export const TASK_PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"] as const;

/**
 * Goal areas offered in the goal form selector. The backend stores `area` as
 * free-form text; these presets mirror the areas listed in `objetivo.md`
 * (finanzas, estudios, trabajo, salud, productividad, proyectos, lectura,
 * aprendizaje, otras) so the user picks by name instead of typing.
 */
export const GOAL_AREA_OPTIONS = [
  "finanzas",
  "estudios",
  "trabajo",
  "salud",
  "productividad",
  "proyectos",
  "lectura",
  "aprendizaje",
  "otras",
] as const;

/**
 * Event kinds offered in the event form selector (subset of the backend
 * `event_kind` enum scoped by S2: evento/cita/pago/recordatorio).
 */
export const EVENT_KIND_OPTIONS = ["event", "appointment", "payment_due", "reminder"] as const;

/** Date-based task views: Hoy / Próximas / Vencidas / Completadas (+ Todas). */
export type TaskDateView = "all" | "today" | "upcoming" | "overdue" | "done";

export const TASK_DATE_VIEWS: TaskDateView[] = ["all", "today", "upcoming", "overdue", "done"];

/** Local `YYYY-MM-DD` for day comparisons (same wall-clock rule as `toISODate`). */
export function todayYmdLocal(now: Date = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export interface TaskDateViewInput {
  status: string;
  due_date: string | null;
  completed_at: string | null;
}

/**
 * Classify one task into its date view. Completed tasks (status or
 * `completed_at`) are always `done`; dateless open tasks wait in `upcoming`;
 * dated open tasks compare `due_date` (`YYYY-MM-DD`) against `todayYmd`.
 */
export function taskDateView(task: TaskDateViewInput, todayYmd: string): Exclude<TaskDateView, "all"> {
  if (task.status === "completed" || task.completed_at) return "done";
  const due = (task.due_date ?? "").trim();
  if (!due) return "upcoming";
  if (due < todayYmd) return "overdue";
  if (due === todayYmd) return "today";
  return "upcoming";
}

/** Filter tasks to one date view (`all` returns a copy of the input). */
export function filterTasksByDateView<T extends TaskDateViewInput>(
  tasks: T[] | null | undefined,
  view: TaskDateView,
  todayYmd: string,
): T[] {
  if (!tasks) return [];
  if (view === "all") return [...tasks];
  return tasks.filter((task) => taskDateView(task, todayYmd) === view);
}

/** Count tasks per date view (including `all` = total). */
export function countTasksByDateView<T extends TaskDateViewInput>(
  tasks: T[] | null | undefined,
  todayYmd: string,
): Record<TaskDateView, number> {
  const counts: Record<TaskDateView, number> = { all: 0, today: 0, upcoming: 0, overdue: 0, done: 0 };
  if (!tasks) return counts;
  counts.all = tasks.length;
  for (const task of tasks) {
    counts[taskDateView(task, todayYmd)] += 1;
  }
  return counts;
}

/** Time-based event views: próximos (incl. hoy) / vencidos (+ todos). */
export type EventTimeView = "all" | "upcoming" | "overdue";

export const EVENT_TIME_VIEWS: EventTimeView[] = ["all", "upcoming", "overdue"];

export interface EventTimeViewInput {
  starts_at: string;
  ends_at: string | null;
}

/**
 * Classify one event by time. The end (or start when dateless-end) decides:
 * anything ending before `nowMs` is `overdue`, the rest is `upcoming`.
 * Unparseable dates stay `upcoming` so they never vanish into vencidos.
 */
export function eventTimeView(event: EventTimeViewInput, nowMs: number): Exclude<EventTimeView, "all"> {
  const start = Date.parse(event.starts_at);
  const end = event.ends_at ? Date.parse(event.ends_at) : NaN;
  const ref = Number.isNaN(end) ? start : end;
  if (Number.isNaN(ref)) return "upcoming";
  return ref < nowMs ? "overdue" : "upcoming";
}

/** Filter events to one time view (`all` returns a copy of the input). */
export function filterEventsByTimeView<T extends EventTimeViewInput>(
  events: T[] | null | undefined,
  view: EventTimeView,
  nowMs: number,
): T[] {
  if (!events) return [];
  if (view === "all") return [...events];
  return events.filter((event) => eventTimeView(event, nowMs) === view);
}

/** Count events per time view (including `all` = total). */
export function countEventsByTimeView<T extends EventTimeViewInput>(
  events: T[] | null | undefined,
  nowMs: number,
): Record<EventTimeView, number> {
  const counts: Record<EventTimeView, number> = { all: 0, upcoming: 0, overdue: 0 };
  if (!events) return counts;
  counts.all = events.length;
  for (const event of events) {
    counts[eventTimeView(event, nowMs)] += 1;
  }
  return counts;
}

/* -- W4: monthly calendar (42-cell Monday-first grid, tasks + events per day) -- */

const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** One cell of the month grid: local `YYYY-MM-DD`, month membership and today. */
export interface CalendarDayCell {
  date: string;
  inMonth: boolean;
  isToday: boolean;
}

function yearMonth(monthKey: string): { year: number; month: number } | null {
  const match = MONTH_KEY_RE.exec(monthKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** Local-day unix bounds `[start, end)` for a `YYYY-MM-DD`, or null when invalid. */
function localDayBounds(date: string): { start: number; end: number } | null {
  const match = DATE_RE.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const start = new Date(year, month - 1, day).getTime();
  if (Number.isNaN(start)) return null;
  return { start, end: new Date(year, month - 1, day + 1).getTime() };
}

function ymdFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * 42 cells (6 weeks, Monday-first) covering `monthKey` (YYYY-MM): the same
 * `(getUTCDay()+6)%7` offset and UTC-midnight arithmetic as
 * `logsToCalendarCells`, so leading/trailing days of adjacent months are
 * included. Invalid month keys return no cells.
 */
export function monthGridCells(monthKey: string, today: string = todayYmdLocal()): CalendarDayCell[] {
  const parts = yearMonth(monthKey);
  if (!parts) return [];
  const first = Date.UTC(parts.year, parts.month - 1, 1);
  const leading = (new Date(first).getUTCDay() + 6) % 7; // Monday-first offset
  const cells: CalendarDayCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = ymdFromMs(first + (i - leading) * DAY_MS);
    cells.push({ date, inMonth: date.slice(0, 7) === monthKey, isToday: date === today });
  }
  return cells;
}

/** First and last date of the 42-cell grid, so reads cover the visible days. */
export function monthGridRange(monthKey: string): { from: string; to: string } {
  const cells = monthGridCells(monthKey);
  if (cells.length === 0) return { from: "", to: "" };
  return { from: cells[0].date, to: cells[cells.length - 1].date };
}

/** Shift a `YYYY-MM` key by `delta` months (calendar-safe across years). */
export function shiftMonth(monthKey: string, delta: number): string {
  const parts = yearMonth(monthKey);
  if (!parts) return monthKey;
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1 + delta, 1));
  const month = `${shifted.getUTCMonth() + 1}`.padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${month}`;
}

/**
 * True when an event occupies any instant of the local `date`. Missing or
 * inverted ends collapse to a point at `starts_at`; invalid starts never
 * match.
 */
export function eventOverlapsDate(
  event: { starts_at: string; ends_at: string | null },
  date: string,
): boolean {
  const bounds = localDayBounds(date);
  if (!bounds) return false;
  const start = Date.parse(event.starts_at);
  if (Number.isNaN(start)) return false;
  const parsedEnd = event.ends_at ? Date.parse(event.ends_at) : NaN;
  if (Number.isNaN(parsedEnd) || parsedEnd <= start) {
    return start >= bounds.start && start < bounds.end;
  }
  return start < bounds.end && parsedEnd > bounds.start;
}

/** Tasks due that day plus events overlapping it, preserving input order. */
export function dayEntries<
  TaskLike extends { due_date: string | null },
  EventLike extends { starts_at: string; ends_at: string | null },
>(
  tasks: TaskLike[] | null | undefined,
  events: EventLike[] | null | undefined,
  date: string,
): { tasks: TaskLike[]; events: EventLike[] } {
  return {
    tasks: (tasks ?? []).filter((task) => (task.due_date ?? "") === date),
    events: (events ?? []).filter((event) => eventOverlapsDate(event, date)),
  };
}

/** Long local date (`15 de octubre`) for calendar labels; invalid input passes through. */
export function calendarDateLabel(date: string, locale: string = "es-CO"): string {
  const bounds = localDayBounds(date);
  if (!bounds) return date;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(new Date(bounds.start));
}
