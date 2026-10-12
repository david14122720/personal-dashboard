"use client";

import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import AppShell from "@/components/layout/AppShell";
import ProductivityCalendar from "@/components/productivity/ProductivityCalendar";
import KpiTile from "@/components/ui/KpiTile";
import { deck } from "@/components/ui/deckStyles";
import { t } from "@/lib/i18n";
import {
  EventsList,
  EventViewTabs,
  GoalsList,
  NewEntryButton,
  NotesResults,
  NotesSearchBox,
  SectionShell,
  TasksList,
  TaskViewTabs,
  type EventCardView,
} from "@/components/productivity/ProductivitySections";
import {
  EventForm,
  GoalForm,
  NoteForm,
  TaskForm,
} from "@/components/productivity/ProductivityForms";
import {
  GOALS_KEY,
  TASKS_KEY,
  deleteEvent,
  deleteGoal,
  deleteNote,
  deleteTask,
  patchTaskStatus,
  updateNote,
  useEvents,
  useGoals,
  useNotesSearch,
  useTasks,
  type EventWire,
  type GoalWire,
  type NoteWire,
  type TaskWire,
} from "@/lib/api/productivity";
import {
  countTasksByDateView,
  eventOverlapsDate,
  eventTimeView,
  eventWhenLabel,
  filterTasksByDateView,
  type TaskDateView,
} from "@/lib/productivity/productivity";
import { toISODate } from "@/lib/dashboard/transforms";

/**
 * Productivity screens container. Owns all SWR reads (fired in parallel),
 * the debounced notes query, and the task-toggle mutations;
 * `components/productivity/*` sections stay pure.
 *
 * T5a adds the module header (focus/sync chips + the real creation entry
 * points), the header-owned calendar toggle and the four KPI tiles whose every
 * figure is recomputed from the same live reads (`productividad-desktop-v2.html`
 * header, calendar and KPI row). No prototype number is hard-coded: a window
 * the reads cannot support renders the honest basis note instead of a value.
 *
 * S2 adds manual CRUD forms (Spanish, selects by name, never raw UUIDs),
 * date-based task views (Hoy / Próximas / Vencidas / Completadas) and event
 * time views (Próximos / Vencidos).
 *
 * Habits live only in `/dashboard/habitos/` (`HabitsDashboard` +
 * `HabitGrid`); this screen owns goals/tasks/events/notes.
 */

// Canonical strings from the UI-polish contract (`design.md`): one role, one
// look for the page subtitle and the ghost/secondary button.
const subtitleClass = "mt-1 text-sm text-slate-400";
const ghostBtn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-hair px-3 font-display text-sm text-instrument-dim transition-colors hover:border-signal hover:text-signal";

const CALENDAR_PANEL_ID = "productivity-calendar-panel";

function SectionsSkeleton() {
  // One placeholder per section of the 12-column grid (Metas, Tareas, Eventos, Notas).
  const spans = [
    "order-2 col-span-12 lg:order-none lg:col-span-6 xl:col-span-6",
    "order-3 col-span-12 lg:order-none lg:col-span-6 xl:col-span-6",
    "order-1 col-span-12 lg:order-none lg:col-span-6 xl:col-span-6",
    "order-4 col-span-12 lg:order-none lg:col-span-6 xl:col-span-6",
  ];
  return (
    <div role="status" aria-label={t("productivity.loadingSections")} aria-busy="true" className="grid grid-cols-12 gap-6">
      {spans.map((span, index) => (
        <div
          key={`${span}-${index}`}
          className={`animate-pulse rounded-xl border border-hair bg-card p-4 sm:p-5 ${span}`}
        >
          <div className="h-4 w-24 rounded bg-hair" />
          <div className="mt-3 h-8 w-32 rounded bg-hair" />
        </div>
      ))}
    </div>
  );
}

function KpiRowSkeleton() {
  return (
    <div
      role="status"
      aria-label={t("productivity.kpiLoading")}
      aria-busy="true"
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="animate-pulse rounded-xl border border-hair bg-card p-4">
          <div className="h-3 w-24 rounded bg-hair" />
          <div className="mt-3 h-7 w-16 rounded bg-hair" />
          <div className="mt-3 h-1.5 w-full rounded bg-hair" />
        </div>
      ))}
    </div>
  );
}

/** Debounce fast-typing search input before it becomes an SWR key. */
export function useDebouncedValue(value: string, delayMs: number = 250): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function revalidateProductivity(mutate: ReturnType<typeof useSWRConfig>["mutate"]): void {
  void mutate((key) => typeof key === "string" && key.startsWith("productivity/"));
}

/* -- T5a KPI math (pure, so every figure can be recomputed from the wire) --- */

const DAY_MS = 86_400_000;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local `YYYY-MM-DD` shifted by whole days (UTC-midnight arithmetic). */
export function addDays(ymd: string, days: number): string {
  const match = YMD_RE.exec(ymd);
  if (!match) return ymd;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + days * DAY_MS;
  return new Date(utc).toISOString().slice(0, 10);
}

/** Monday of the ISO week that contains a local `YYYY-MM-DD`. */
export function startOfIsoWeek(ymd: string): string {
  const match = YMD_RE.exec(ymd);
  if (!match) return ymd;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const mondayOffset = (new Date(utc).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(ymd, -mondayOffset);
}

export interface WeekCompletion {
  done: number;
  total: number;
  /** `null` when the window holds no dated task: never a fabricated 0%. */
  pct: number | null;
}

export interface WeekTaskLike {
  due_date: string | null;
  status: string;
  completed_at: string | null;
}

/**
 * Real weekly completion rate: of the tasks whose `due_date` falls inside the
 * local `[fromYmd, toYmd]` window, how many are closed (status `completed` or
 * a real `completed_at`). The prototype's `82%` / `74.6%` / `+7.4%` are never
 * rendered; this computes both windows from `GET /tasks`.
 */
export function weekCompletion(tasks: WeekTaskLike[], fromYmd: string, toYmd: string): WeekCompletion {
  const dated = tasks.filter((task) => {
    const due = task.due_date ?? "";
    return due >= fromYmd && due <= toYmd;
  });
  const done = dated.filter((task) => task.status === "completed" || Boolean(task.completed_at)).length;
  const total = dated.length;
  return { done, total, pct: total === 0 ? null : Math.round((done / total) * 100) };
}

/** End instant of an event; a missing end is a point at `starts_at`. */
function eventEndMs(event: { starts_at: string; ends_at: string | null }): number {
  const end = event.ends_at ? Date.parse(event.ends_at) : NaN;
  const start = Date.parse(event.starts_at);
  return Number.isNaN(end) ? start : Math.max(end, Number.isNaN(start) ? end : start);
}

/** Spanish count phrase with singular/plural keys (i18n has no plural engine). */
function countText(count: number, oneKey: Parameters<typeof t>[0], manyKey: Parameters<typeof t>[0]): string {
  return count === 1 ? t(oneKey) : t(manyKey, { n: count });
}

/** `HH:MM` of today's event list (`todo el día` for all-day rows). */
function timeLabel(event: { starts_at: string; all_day: boolean }): string {
  if (event.all_day) return t("productivity.kpiAllDay");
  const date = new Date(event.starts_at);
  if (Number.isNaN(date.getTime())) return event.starts_at;
  return date.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export interface ProductivityEventRow {
  id: string;
  title: string;
  /** Pre-formatted real time (today) or real day+time (upcoming). */
  when: string;
}

export interface ProductivityKpisProps {
  completion: { done: number; total: number; pct: number | null; prevPct: number | null };
  activeTasks: { count: number; urgent: number; inProgress: number; closedThisWeek: number };
  goals: { count: number; progress: number; linkedTasks: number };
  todayEvents: { count: number; rows: ProductivityEventRow[]; nothingLeftToday: boolean };
}

/** The four KPI tiles of the module (`productividad-desktop-v2.html:116`), all
 * fed by the container's live reads through the shared `KpiTile` primitive. */
function ProductivityKpis({ completion, activeTasks, goals, todayEvents }: ProductivityKpisProps) {
  const delta =
    completion.pct !== null && completion.prevPct !== null ? completion.pct - completion.prevPct : null;
  const complianceFooter =
    completion.pct === null
      ? t("productivity.kpiComplianceEmpty")
      : `${t("productivity.kpiComplianceBasis", { done: completion.done, total: completion.total })} · ${
          completion.prevPct === null
            ? t("productivity.kpiComplianceNoPrev")
            : t("productivity.kpiComplianceVsPrev", { pct: completion.prevPct })
        }`;
  const hasTaskChips = activeTasks.urgent > 0 || activeTasks.inProgress > 0;
  return (
    <section aria-label={t("productivity.kpiSummaryLabel")} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiTile
        label={t("productivity.kpiCompliance")}
        icon={<TrendIcon className="h-3.5 w-3.5" />}
        signal
        glow="corner"
        value={completion.pct === null ? "—" : `${completion.pct}%`}
        valueClass={deck.kpiValue}
        valueSuffix={
          delta === null ? undefined : (
            <span className={delta >= 0 ? deck.kpiDeltaUp : deck.kpiDeltaDown}>
              {delta >= 0
                ? t("productivity.kpiDeltaUp", { n: delta })
                : t("productivity.kpiDeltaDown", { n: Math.abs(delta) })}
            </span>
          )
        }
      >
        {completion.pct === null ? null : (
          <div
            role="progressbar"
            aria-label={t("productivity.kpiComplianceBar", {
              done: completion.done,
              total: completion.total,
            })}
            aria-valuenow={completion.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            className={deck.kpiProgressTrack}
          >
            <div className={deck.kpiProgressFillSignal} style={{ width: `${completion.pct}%` }} />
          </div>
        )}
        <p className={deck.kpiFooter}>
          <span className="line-clamp-2">{complianceFooter}</span>
        </p>
      </KpiTile>

      <KpiTile
        label={t("productivity.kpiActiveTasks")}
        icon={<TaskIcon className="h-3.5 w-3.5" />}
        value={String(activeTasks.count)}
        valueClass={deck.kpiValue}
        unit={t("productivity.kpiActiveTasksUnit")}
      >
        {hasTaskChips ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {activeTasks.urgent > 0 ? (
              <span className={deck.kpiChipAlert}>
                {countText(activeTasks.urgent, "productivity.kpiUrgentOne", "productivity.kpiUrgentMany")}
              </span>
            ) : null}
            {activeTasks.inProgress > 0 ? (
              <span className={deck.kpiChipNeutral}>
                {countText(
                  activeTasks.inProgress,
                  "productivity.kpiInProgressOne",
                  "productivity.kpiInProgressMany",
                )}
              </span>
            ) : null}
          </div>
        ) : null}
        <p className={deck.kpiFooter}>
          <span className="line-clamp-2">
            {activeTasks.closedThisWeek > 0
              ? countText(activeTasks.closedThisWeek, "productivity.kpiClosedWeekOne", "productivity.kpiClosedWeekMany")
              : t("productivity.kpiClosedWeekNone")}
          </span>
        </p>
      </KpiTile>

      <KpiTile
        label={t("productivity.kpiGoals")}
        icon={<GoalIcon className="h-3.5 w-3.5" />}
        value={String(goals.count)}
        valueClass={deck.kpiValue}
        unit={countText(goals.count, "productivity.kpiGoalsUnitOne", "productivity.kpiGoalsUnitMany")}
      >
        {goals.count > 0 ? (
          <div
            role="progressbar"
            aria-label={t("productivity.kpiGoalsBar")}
            aria-valuenow={goals.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className={deck.kpiProgressTrack}
          >
            <div className={deck.kpiProgressFillFlow} style={{ width: `${goals.progress}%` }} />
          </div>
        ) : null}
        <p className={deck.kpiFooter}>
          <span className="line-clamp-2">
            {goals.count === 0
              ? t("productivity.kpiGoalsNoActive")
              : `${t("productivity.kpiGoalsProgress", { pct: goals.progress })}${
                  goals.linkedTasks > 0
                    ? ` · ${countText(goals.linkedTasks, "productivity.kpiGoalsLinkedOne", "productivity.kpiGoalsLinkedMany")}`
                    : ""
                }`}
          </span>
        </p>
      </KpiTile>

      <KpiTile
        label={t("productivity.kpiTodayEvents")}
        icon={<ClockIcon className="h-3.5 w-3.5" />}
        signal
        value={String(todayEvents.count)}
        valueClass={deck.kpiValue}
        unit={countText(todayEvents.count, "productivity.kpiTodayEventsUnitOne", "productivity.kpiTodayEventsUnitMany")}
      >
        {todayEvents.rows.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1">
            {todayEvents.rows.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-instrument">{event.title}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted">{event.when}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {todayEvents.nothingLeftToday ? (
          <p className={deck.kpiFooter}>
            <span className="line-clamp-2">
              {todayEvents.count === 0 ? t("productivity.kpiTodayEventsNone") : t("productivity.kpiTodayEventsDone")}
            </span>
          </p>
        ) : null}
      </KpiTile>
    </section>
  );
}

type ProductivitySectionId = "goals" | "tasks" | "events" | "notes";

const FORM_IDS: Record<ProductivitySectionId, string> = {
  goals: "productivity-form-goals",
  tasks: "productivity-form-tasks",
  events: "productivity-form-events",
  notes: "productivity-form-notes",
};

/* Inline SVG icons (D3: the prototypes' Material Symbols names are mapped to
 * inline paths; no icon-font dependency). All decorative. */
function CalendarWeekIcon({ className }: { className?: string }) {
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
      <path d="M4 5h16a1 1 0 011 1v13a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zM8 3v4M16 3v4M3 10h18M8 10v10M16 10v10" />
    </svg>
  );
}

function SyncIcon({ className }: { className?: string }) {
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
      <path d="M4 4v6h6M20 20v-6h-6M20 9a8 8 0 00-14.9-2M4 15a8 8 0 0014.9 2" />
    </svg>
  );
}

function TrendIcon({ className }: { className?: string }) {
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
      <path d="M3 17l6-6 4 4 7-7M15 8h6v6" />
    </svg>
  );
}

function TaskIcon({ className }: { className?: string }) {
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
      <path d="M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9" />
    </svg>
  );
}

function GoalIcon({ className }: { className?: string }) {
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
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** Header mirror of the section `Nuevo` toggles: same single-open state, its
 * own real label, and the same `aria-expanded`/`aria-controls` contract. */
function HeaderEntryButton({
  label,
  formId,
  open,
  primary,
  onToggle,
}: {
  label: string;
  formId: string;
  open: boolean;
  primary?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={formId}
      onClick={onToggle}
      className={primary ? deck.headerActionSignal : deck.headerAction}
    >
      {label}
    </button>
  );
}

export default function ProductivityScreens() {
  const { mutate } = useSWRConfig();
  const [query, setQuery] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [taskView, setTaskView] = useState<TaskDateView>("all");
  const [eventView, setEventView] = useState<EventCardView>("all");
  const [editingTask, setEditingTask] = useState<TaskWire | null>(null);
  const [editingGoal, setEditingGoal] = useState<GoalWire | null>(null);
  const [editingEvent, setEditingEvent] = useState<EventWire | null>(null);
  const [editingNote, setEditingNote] = useState<NoteWire | null>(null);
  /** Collapsed-form state machine: at most one section form open at a time.
   * `null` renders the four lists with their «Nuevo» toggles and no form. */
  const [openSection, setOpenSection] = useState<ProductivitySectionId | null>(null);
  /** The T5a module header owns the collapsible calendar toggle. */
  const [calendarOpen, setCalendarOpen] = useState(false);
  const toggleRefs = useRef<Record<ProductivitySectionId, HTMLButtonElement | null>>({
    goals: null,
    tasks: null,
    events: null,
    notes: null,
  });
  const prevOpenRef = useRef<ProductivitySectionId | null>(null);
  /** Local-day bounds of the KPI "Eventos de hoy" read, pinned once per mount
   * so the SWR key stays stable. */
  const [todayBounds] = useState(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + DAY_MS - 1);
    return { from: start.toISOString(), to: end.toISOString() };
  });
  const debouncedQuery = useDebouncedValue(query.trim());

  const goals = useGoals();
  const tasks = useTasks();
  // The Eventos card renders real VENCIDOS/HOY counts, so it reads the full
  // owned list (same hook and endpoint; both bounds are optional).
  const events = useEvents(null, null);
  const todayEventsQuery = useEvents(todayBounds.from, todayBounds.to);
  const notes = useNotesSearch(debouncedQuery);

  const queries = [goals, tasks, events, todayEventsQuery, notes];
  const isLoading = queries.some((q) => q.isLoading);
  const failed = queries.filter((q) => q.error);

  const todayYmd = toISODate(new Date());
  const nowMs = Date.now();
  const allTasks = tasks.data ?? [];
  const visibleTasks = filterTasksByDateView(allTasks, taskView, todayYmd);
  const taskCounts = countTasksByDateView(allTasks, todayYmd);
  const allEvents = events.data ?? [];
  const goalOptions = (goals.data ?? []).map((goal) => ({ id: goal.id, name: goal.name }));
  const goalNameById: Record<string, string> = Object.fromEntries(
    goalOptions.map((goal) => [goal.id, goal.name]),
  );
  // Real per-goal task counts for the Metas meta line.
  const goalTaskCounts: Record<string, { total: number; done: number }> = {};
  for (const task of allTasks) {
    if (!task.goal_id) continue;
    const counts = (goalTaskCounts[task.goal_id] ??= { total: 0, done: 0 });
    counts.total += 1;
    if (task.status === "completed") counts.done += 1;
  }
  // Eventos card: real day-based partition of the owned list. `today` is
  // every event that touches the local day (even one whose hour already
  // passed); `overdue` only the ones that ended before today; `upcoming` the
  // future days. The three pills always add up to `all`.
  const todaySectionEvents = allEvents.filter((event) => eventOverlapsDate(event, todayYmd));
  const todaySectionEventIds = new Set(todaySectionEvents.map((event) => event.id));
  const overdueEvents = allEvents.filter(
    (event) => !todaySectionEventIds.has(event.id) && eventTimeView(event, nowMs) === "overdue",
  );
  const overdueEventIds = new Set(overdueEvents.map((event) => event.id));
  const upcomingSectionEvents = allEvents.filter(
    (event) => !todaySectionEventIds.has(event.id) && !overdueEventIds.has(event.id),
  );
  const eventCounts: Record<EventCardView, number> = {
    all: allEvents.length,
    today: todaySectionEvents.length,
    upcoming: upcomingSectionEvents.length,
    overdue: overdueEvents.length,
  };
  const visibleEvents =
    eventView === "today"
      ? todaySectionEvents
      : eventView === "upcoming"
        ? upcomingSectionEvents
        : eventView === "overdue"
          ? overdueEvents
          : allEvents;

  // -- T5a KPI figures: all four recomputed from `GET /tasks|goals|events` --
  const weekStart = startOfIsoWeek(todayYmd);
  const weekEnd = addDays(weekStart, 6);
  const thisWeek = weekCompletion(allTasks, weekStart, weekEnd);
  const prevWeek = weekCompletion(allTasks, addDays(weekStart, -7), addDays(weekStart, -1));
  const activeTasks = allTasks.filter((task) => task.status !== "completed" && task.status !== "cancelled");
  const closedThisWeek = allTasks.filter((task) => {
    if (!task.completed_at) return false;
    const closed = toISODate(new Date(task.completed_at));
    return closed >= weekStart && closed <= weekEnd;
  }).length;
  const activeGoals = (goals.data ?? []).filter((goal) => goal.status === "active");
  const activeGoalIds = new Set(activeGoals.map((goal) => goal.id));
  const goalsProgress =
    activeGoals.length === 0
      ? 0
      : Math.round(
          activeGoals.reduce((sum, goal) => sum + (Number.isFinite(goal.progress) ? goal.progress : 0), 0) /
            activeGoals.length,
        );
  const linkedTasks = allTasks.filter((task) => task.goal_id && activeGoalIds.has(task.goal_id)).length;
  // The backend's range predicate keeps a past point event (`ends_at IS NULL`)
  // inside today's range, so the local-day overlap filter is what makes the
  // tile count honest.
  const todayEvents = (todayEventsQuery.data ?? []).filter((event) => eventOverlapsDate(event, todayYmd));
  const nextTodayEvents = todayEvents
    .filter((event) => eventEndMs(event) >= nowMs)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .slice(0, 2);
  // When today has nothing left, the tile still shows the next real events
  // (each row carries its own real date) instead of an empty list.
  const todayIds = new Set(todayEvents.map((event) => event.id));
  const nextUpcomingEvents = allEvents
    .filter((event) => !todayIds.has(event.id) && eventEndMs(event) >= nowMs)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const nextTodayEventIds = new Set(nextTodayEvents.map((event) => event.id));
  const todayEventRows: ProductivityEventRow[] = [
    ...nextTodayEvents.map((event) => ({ id: event.id, title: event.title, when: timeLabel(event) })),
    ...nextUpcomingEvents.map((event) => ({
      id: event.id,
      title: event.title,
      when: eventWhenLabel(event.starts_at, event.all_day),
    })),
  ].slice(0, 2);

  async function handleToggle(task: TaskWire) {
    setTogglingId(task.id);
    try {
      await patchTaskStatus(task.id, task.status === "completed" ? "pending" : "completed");
      await mutate(TASKS_KEY);
      await mutate(GOALS_KEY);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDeleteTask(task: TaskWire) {
    setActionError(null);
    setDeletingId(task.id);
    try {
      await deleteTask(task.id);
      if (editingTask?.id === task.id) setEditingTask(null);
      revalidateProductivity(mutate);
    } catch {
      setActionError(t("productivity.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDeleteGoal(goal: GoalWire) {
    setActionError(null);
    setDeletingId(goal.id);
    try {
      await deleteGoal(goal.id);
      if (editingGoal?.id === goal.id) setEditingGoal(null);
      revalidateProductivity(mutate);
    } catch {
      setActionError(t("productivity.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDeleteEvent(event: EventWire) {
    setActionError(null);
    setDeletingId(event.id);
    try {
      await deleteEvent(event.id);
      if (editingEvent?.id === event.id) setEditingEvent(null);
      revalidateProductivity(mutate);
    } catch {
      setActionError(t("productivity.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDeleteNote(note: NoteWire) {
    setActionError(null);
    setDeletingId(note.id);
    try {
      await deleteNote(note.id);
      if (editingNote?.id === note.id) setEditingNote(null);
      revalidateProductivity(mutate);
    } catch {
      setActionError(t("productivity.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleTogglePin(note: NoteWire) {
    setActionError(null);
    setPinningId(note.id);
    try {
      await updateNote(note.id, { is_pinned: !note.is_pinned });
      revalidateProductivity(mutate);
    } catch {
      setActionError(t("productivity.deleteFailed"));
    } finally {
      setPinningId(null);
    }
  }

  function retry() {
    void mutate((key) => typeof key === "string" && key.startsWith("productivity/"));
  }

  /** Opening any section discards the previous draft (single-open invariant). */
  function openForm(section: ProductivitySectionId): void {
    if (section !== "goals") setEditingGoal(null);
    if (section !== "tasks") setEditingTask(null);
    if (section !== "events") setEditingEvent(null);
    if (section !== "notes") setEditingNote(null);
    setOpenSection(section);
  }

  /** Submit, cancel and onDone collapse the form and clear every draft. */
  function closeForms(): void {
    setOpenSection(null);
    setEditingGoal(null);
    setEditingTask(null);
    setEditingEvent(null);
    setEditingNote(null);
  }

  function toggleForm(section: ProductivitySectionId): void {
    if (openSection === section) closeForms();
    else openForm(section);
  }

  // Focus management: first field on open, back to the toggle on collapse.
  // No animation is introduced, so prefers-reduced-motion needs no handling.
  useEffect(() => {
    const prev = prevOpenRef.current;
    prevOpenRef.current = openSection;
    if (openSection) {
      const first = document
        .getElementById(FORM_IDS[openSection])
        ?.querySelector("input, select, textarea") as HTMLElement | null;
      first?.focus({ preventScroll: true });
    } else if (prev) {
      toggleRefs.current[prev]?.focus({ preventScroll: true });
    }
  }, [openSection]);

  const dataReady = !isLoading && failed.length === 0;

  return (
    <div>
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-wide">{t("productivity.title")}</h1>
            <span className={deck.focusChip}>
              <span aria-hidden="true" className={deck.focusChipDot} />
              {t("productivity.focusChip")}
            </span>
            {isLoading ? (
              <span className={deck.syncChipPending}>{t("productivity.syncPending")}</span>
            ) : failed.length === 0 ? (
              <span className={deck.syncChip}>
                <SyncIcon className="h-3 w-3" />
                {t("productivity.syncBadge")}
              </span>
            ) : null}
          </div>
          <p className={subtitleClass}>{t("productivity.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-expanded={calendarOpen}
            aria-controls={CALENDAR_PANEL_ID}
            onClick={() => setCalendarOpen((value) => !value)}
            className={deck.headerAction}
          >
            <CalendarWeekIcon className="h-4 w-4 text-signal" />
            {calendarOpen ? t("productivity.calendarHide") : t("productivity.calendarShow")}
          </button>
          {dataReady ? (
            <>
              <HeaderEntryButton
                label={t("productivity.quickGoal")}
                formId={FORM_IDS.goals}
                open={openSection === "goals"}
                onToggle={() => toggleForm("goals")}
              />
              <HeaderEntryButton
                label={t("productivity.quickEvent")}
                formId={FORM_IDS.events}
                open={openSection === "events"}
                onToggle={() => toggleForm("events")}
              />
              <HeaderEntryButton
                label={t("productivity.quickNote")}
                formId={FORM_IDS.notes}
                open={openSection === "notes"}
                onToggle={() => toggleForm("notes")}
              />
              <HeaderEntryButton
                label={t("productivity.quickTask")}
                formId={FORM_IDS.tasks}
                open={openSection === "tasks"}
                primary
                onToggle={() => toggleForm("tasks")}
              />
            </>
          ) : null}
        </div>
      </header>
      {actionError ? (
        <p role="alert" className="mt-4 rounded-xl border border-alert/50 bg-alert/10 p-4 text-sm">
          {actionError}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-6">
        <ProductivityCalendar open={calendarOpen} onToggle={() => setCalendarOpen((value) => !value)} />
        {isLoading ? (
          <>
            <KpiRowSkeleton />
            <SectionsSkeleton />
          </>
        ) : failed.length > 0 ? (
          <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-5">
            <h2 className="font-display text-base font-medium tracking-wide">{t("productivity.loadFailed")}</h2>
            <p className="mt-1 text-sm text-slate-400">
              {t("productivity.loadFailedDetail", { failed: failed.length, total: queries.length })}
            </p>
            <button
              type="button"
              onClick={retry}
              className={`mt-4 ${ghostBtn}`}
            >
              {t("common.retry")}
            </button>
          </div>
        ) : (
          <>
            <ProductivityKpis
              completion={{
                done: thisWeek.done,
                total: thisWeek.total,
                pct: thisWeek.pct,
                prevPct: prevWeek.pct,
              }}
              activeTasks={{
                count: activeTasks.length,
                urgent: activeTasks.filter((task) => task.priority === "urgent").length,
                inProgress: activeTasks.filter((task) => task.status === "in_progress").length,
                closedThisWeek,
              }}
              goals={{ count: activeGoals.length, progress: goalsProgress, linkedTasks }}
              todayEvents={{
                count: todayEvents.length,
                rows: todayEventRows,
                nothingLeftToday: nextTodayEventIds.size === 0,
              }}
            />
            <div className="grid grid-cols-12 gap-6">
              {/* DOM order is the desktop 2-column pairing (Metas/Eventos left,
                  Tareas/Notas right); below `lg` the `order-*` classes stack
                  the sections in the mobile prototype's order (Tareas first). */}
              <SectionShell
                title={t("productivity.goals")}
                hint={t("productivity.goalsHint")}
                span="order-2 col-span-12 lg:order-none lg:col-span-6 xl:col-span-6"
                action={
                  <NewEntryButton
                    ref={(el) => {
                      toggleRefs.current.goals = el;
                    }}
                    section={t("productivity.goals")}
                    label={t("productivity.newEntryGoal")}
                    ariaLabel={t("productivity.newEntryGoalLabel")}
                    formId={FORM_IDS.goals}
                    open={openSection === "goals"}
                    onToggle={() => toggleForm("goals")}
                  />
                }
              >
                {openSection === "goals" ? (
                  <div id={FORM_IDS.goals}>
                    <GoalForm
                      key={editingGoal ? `edit-${editingGoal.id}` : "new-goal"}
                      initial={editingGoal}
                      onDone={closeForms}
                    />
                  </div>
                ) : null}
                <GoalsList
                  goals={goals.data ?? []}
                  taskCountsByGoal={goalTaskCounts}
                  deletingId={deletingId}
                  onEdit={(goal) => {
                    setEditingGoal(goal);
                    openForm("goals");
                  }}
                  onDelete={(goal) => void handleDeleteGoal(goal)}
                />
              </SectionShell>
              <SectionShell
                title={t("productivity.events")}
                hint={t("productivity.eventsHint")}
                span="order-3 col-span-12 lg:order-none lg:col-span-6 xl:col-span-6"
                action={
                  <NewEntryButton
                    ref={(el) => {
                      toggleRefs.current.events = el;
                    }}
                    section={t("productivity.events")}
                    formId={FORM_IDS.events}
                    open={openSection === "events"}
                    onToggle={() => toggleForm("events")}
                  />
                }
              >
                {openSection === "events" ? (
                  <div id={FORM_IDS.events}>
                    <EventForm
                      key={editingEvent ? `edit-${editingEvent.id}` : "new-event"}
                      initial={editingEvent}
                      onDone={closeForms}
                    />
                  </div>
                ) : null}
                <EventViewTabs view={eventView} counts={eventCounts} onView={setEventView} />
                <EventsList
                  events={visibleEvents}
                  view={eventView}
                  deletingId={deletingId}
                  onEdit={(event) => {
                    setEditingEvent(event);
                    openForm("events");
                  }}
                  onDelete={(event) => void handleDeleteEvent(event)}
                />
              </SectionShell>
              <SectionShell
                title={t("productivity.tasks")}
                hint={t("productivity.tasksHint")}
                span="order-1 col-span-12 lg:order-none lg:col-span-6 xl:col-span-6"
                action={
                  <NewEntryButton
                    ref={(el) => {
                      toggleRefs.current.tasks = el;
                    }}
                    section={t("productivity.tasks")}
                    formId={FORM_IDS.tasks}
                    open={openSection === "tasks"}
                    onToggle={() => toggleForm("tasks")}
                  />
                }
              >
                {openSection === "tasks" ? (
                  <div id={FORM_IDS.tasks}>
                    <TaskForm
                      key={editingTask ? `edit-${editingTask.id}` : "new-task"}
                      goals={goalOptions}
                      initial={editingTask}
                      onDone={closeForms}
                    />
                  </div>
                ) : null}
                <TaskViewTabs view={taskView} counts={taskCounts} onView={setTaskView} />
                <TasksList
                  tasks={visibleTasks}
                  view={taskView}
                  togglingId={togglingId}
                  onToggle={(t) => void handleToggle(t)}
                  deletingId={deletingId}
                  goalNameById={goalNameById}
                  onEdit={(task) => {
                    setEditingTask(task);
                    openForm("tasks");
                  }}
                  onDelete={(task) => void handleDeleteTask(task)}
                />
              </SectionShell>
              <SectionShell
                title={t("productivity.notes")}
                hint={t("productivity.notesHint")}
                span="order-4 col-span-12 lg:order-none lg:col-span-6 xl:col-span-6"
                action={
                  <NewEntryButton
                    ref={(el) => {
                      toggleRefs.current.notes = el;
                    }}
                    section={t("productivity.notes")}
                    formId={FORM_IDS.notes}
                    open={openSection === "notes"}
                    onToggle={() => toggleForm("notes")}
                  />
                }
              >
                {openSection === "notes" ? (
                  <div id={FORM_IDS.notes}>
                    <NoteForm
                      key={editingNote ? `edit-${editingNote.id}` : "new-note"}
                      initial={editingNote}
                      onDone={closeForms}
                    />
                  </div>
                ) : null}
                <NotesSearchBox query={query} onQuery={setQuery} />
                <NotesResults
                  notes={notes.data ?? []}
                  deletingId={deletingId}
                  pinningId={pinningId}
                  onEdit={(note) => {
                    setEditingNote(note);
                    openForm("notes");
                  }}
                  onDelete={(note) => void handleDeleteNote(note)}
                  onTogglePin={(note) => void handleTogglePin(note)}
                />
              </SectionShell>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function ProductivityScreensShell() {
  return (
    <AppShell>
      <ProductivityScreens />
    </AppShell>
  );
}
