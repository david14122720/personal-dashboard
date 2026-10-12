"use client";

import EmptyState from "@/components/ui/EmptyState";
import { deck } from "@/components/ui/deckStyles";
import { t } from "@/lib/i18n";
import type { EventWire, GoalWire, NoteWire, TaskWire } from "@/lib/api/productivity";
import { ledDotClass } from "@/lib/dashboard/transforms";
import {
  goalProgressFraction,
  noteExcerpt,
  type TaskDateView,
} from "@/lib/productivity/productivity";
import { BOGOTA_TZ } from "@/lib/time/bogota";

/**
 * Pure presentational sections for the productivity screens. The container
 * owns all SWR reads, debounced search state, and log/toggle mutations;
 * these components receive plain views and callbacks only.
 *
 * T5b restyles the four content cards onto the Control Deck recipes in
 * `deckStyles.ts` while keeping every real control: the goal `Editar` /
 * `Eliminar` actions replace the prototype's `Vincular tareas` / `Ver
 * desglose` (the app has no such operations, so they are never rendered as
 * dead controls), the task checkbox is the real `PATCH /tasks` toggle, and
 * the event rows carry the real Bogotá date/time. Every count and date is
 * computed from the wire (D10); the prototype's fabricated figures are gone.
 */

/** Bogotá calendar for the event date block and the note timestamps (the
 * zone itself is the app-wide `BOGOTA_TZ` constant). */
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `10 sept` for a real `YYYY-MM-DD` calendar date (prototype `Vence 20 oct`). */
export function formatShortDate(ymd: string): string {
  const match = YMD_RE.exec(ymd);
  if (!match) return ymd;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString("es", { day: "numeric", month: "short" });
}

/** `OCT` + `11` of a real start instant, read on the Bogotá calendar. */
export function eventDateParts(iso: string): { month: string; day: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const month = new Intl.DateTimeFormat("es-CO", { month: "short", timeZone: BOGOTA_TZ })
    .format(date)
    .replace(/\.$/, "")
    .toUpperCase();
  const day = new Intl.DateTimeFormat("es-CO", { day: "numeric", timeZone: BOGOTA_TZ }).format(date);
  return { month, day };
}

function bogotaTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: BOGOTA_TZ,
  }).format(date);
}

/** Real start–end range in Bogotá (`todo el día` for all-day rows). */
export function eventTimeRange(event: {
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
}): string {
  if (event.all_day) return t("productivity.kpiAllDay");
  const start = bogotaTime(event.starts_at);
  return event.ends_at ? `${start} – ${bogotaTime(event.ends_at)}` : start;
}

/** Long real date (`7 de septiembre de 2026`) for the note card footer. */
function formatLongDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: BOGOTA_TZ,
  }).format(date);
}

/** Inline SVG icons (D3): the prototypes' Material Symbols names are mapped to
 * inline paths; no icon-font dependency. All decorative. */
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
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
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function DeleteButton({
  label,
  pending,
  onDelete,
}: {
  label: string;
  pending: boolean;
  onDelete: () => void;
}) {
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={label}
      onClick={onDelete}
      className={deck.cardTextAction}
    >
      {pending ? t("productivity.deleting") : t("productivity.delete")}
    </button>
  );
}

function EditButton({ label, onEdit }: { label: string; onEdit: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onEdit} className={deck.cardTextActionSignal}>
      {t("productivity.edit")}
    </button>
  );
}

/** One pill of a content-card filter row; `aria-pressed` carries the state. */
function ViewPill({
  active,
  label,
  onSelect,
}: {
  active: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={active ? deck.cardPillActive : deck.cardPillIdle}
    >
      {label}
    </button>
  );
}

/** Date-view tabs (Todas / Hoy / Próximas / Vencidas / Completadas). Counts in parens. */
export function TaskViewTabs({
  view,
  counts,
  onView,
}: {
  view: TaskDateView;
  counts: Record<TaskDateView, number>;
  onView: (next: TaskDateView) => void;
}) {
  const options: Array<{ value: TaskDateView; label: string }> = [
    { value: "all", label: t("productivity.viewAll") },
    { value: "today", label: t("productivity.viewToday") },
    { value: "upcoming", label: t("productivity.viewUpcoming") },
    { value: "overdue", label: t("productivity.viewOverdue") },
    { value: "done", label: t("productivity.viewDone") },
  ];
  return (
    <div role="group" aria-label={t("productivity.tasks")} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <ViewPill
          key={option.value}
          active={view === option.value}
          label={`${option.label} (${counts[option.value] ?? 0})`}
          onSelect={() => onView(option.value)}
        />
      ))}
    </div>
  );
}

/** Event-card views: real counts partition Todos into Hoy / Próximos / Vencidos. */
export type EventCardView = "all" | "today" | "upcoming" | "overdue";

/** Time-view tabs (Todos / Hoy / Próximos / Vencidos) for the events list. */
export function EventViewTabs({
  view,
  counts,
  onView,
}: {
  view: EventCardView;
  counts: Record<EventCardView, number>;
  onView: (next: EventCardView) => void;
}) {
  const options: Array<{ value: EventCardView; label: string }> = [
    { value: "all", label: t("productivity.viewAllEvents") },
    { value: "today", label: t("productivity.viewToday") },
    { value: "upcoming", label: t("productivity.viewUpcomingEvents") },
    { value: "overdue", label: t("productivity.viewOverdueEvents") },
  ];
  return (
    <div role="group" aria-label={t("productivity.events")} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <ViewPill
          key={option.value}
          active={view === option.value}
          label={`${option.label} (${counts[option.value] ?? 0})`}
          onSelect={() => onView(option.value)}
        />
      ))}
    </div>
  );
}

/** Per-section collapsed-form toggle («Nuevo» / «Nueva»). Always rendered in
 * the section header — including over an empty list — so creation is never a
 * dead end. `aria-expanded`/`aria-controls` expose the collapsed state; focus
 * moves into the form on open and back here on collapse. */
export function NewEntryButton({
  section,
  formId,
  open,
  onToggle,
  ref,
  label,
  ariaLabel,
}: {
  section: string;
  formId: string;
  open: boolean;
  onToggle: () => void;
  ref?: React.Ref<HTMLButtonElement>;
  /** Visible label override (`Nueva` on Metas). */
  label?: string;
  /** Accessible-name override; it must contain the visible label (WCAG 2.5.3). */
  ariaLabel?: string;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      aria-controls={formId}
      aria-label={ariaLabel ?? t("productivity.newEntryLabel", { section })}
      onClick={onToggle}
      className={deck.cardAction}
    >
      {label ?? t("productivity.newEntry")}
    </button>
  );
}

export function SectionShell({
  title,
  hint,
  action,
  children,
  span,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  span: string;
}) {
  return (
    <section aria-label={title} className={`${deck.panel} flex min-w-0 flex-col ${span}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={deck.sectionTitle}>{title}</h2>
          {hint ? <p className={deck.sectionSubtitle}>{hint}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function ProgressBar({ pct, status, label }: { pct: number; status: string; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={deck.cardProgressTrack}
    >
      <div className={`h-full rounded-full ${ledDotClass(status)}`} style={{ width: `${pct * 100}%` }} />
    </div>
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
  if (priority === "high") return t("productivity.taskPriorityHigh");
  if (priority === "medium") return t("productivity.taskPriorityMedium");
  if (priority === "low") return t("productivity.taskPriorityLow");
  if (priority === "urgent") return t("productivity.taskPriorityUrgent");
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

function goalStatusText(status: string): string {
  if (status === "active") return t("productivity.goalStatusActive");
  if (status === "completed") return t("productivity.goalStatusCompleted");
  if (status === "paused") return t("productivity.goalStatusPaused");
  if (status === "cancelled") return t("productivity.goalStatusCancelled");
  return status;
}

function goalLed(status: string): string {
  if (status === "completed") return "ok";
  if (status === "paused") return "warn";
  if (status === "cancelled") return "over";
  return "ok";
}

/** Real goal area chip: preset areas are translated, anything else shows as stored. */
const GOAL_AREA_LABEL_KEYS: Record<string, Parameters<typeof t>[0]> = {
  finanzas: "productivity.goalAreaFinances",
  estudios: "productivity.goalAreaStudy",
  trabajo: "productivity.goalAreaWork",
  salud: "productivity.goalAreaHealth",
  productividad: "productivity.goalAreaProductivity",
  proyectos: "productivity.goalAreaProjects",
  lectura: "productivity.goalAreaReading",
  aprendizaje: "productivity.goalAreaLearning",
  otras: "productivity.goalAreaOther",
};

function goalAreaChipLabel(area: string): string {
  const key = GOAL_AREA_LABEL_KEYS[area];
  return key ? t(key) : area;
}

/** Real linked-task summary of one goal, or the honest "none" note. */
function linkedTaskText(counts: { total: number; done: number } | undefined): string {
  if (!counts || counts.total === 0) return t("productivity.noLinkedTasks");
  return counts.total === 1
    ? t("productivity.goalTasksReadyOne", { done: counts.done })
    : t("productivity.goalTasksReadyMany", { done: counts.done, total: counts.total });
}

export function GoalsList({
  goals,
  onEdit,
  onDelete,
  deletingId,
  taskCountsByGoal,
}: {
  goals: GoalWire[];
  onEdit?: (goal: GoalWire) => void;
  onDelete?: (goal: GoalWire) => void;
  deletingId?: string | null;
  /** Real per-goal task counts computed from `GET /tasks` by the container. */
  taskCountsByGoal?: Record<string, { total: number; done: number }>;
}) {
  if (goals.length === 0) {
    return <EmptyState title={t("productivity.noGoals")} hint={t("productivity.noGoalsHint")} />;
  }
  return (
    <ul className="flex flex-col gap-3">
      {goals.map((goal) => {
        const fraction = goalProgressFraction(goal.progress);
        return (
          <li key={goal.id} className={deck.cardRow}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`${deck.goalDot} ${goal.color ? "" : ledDotClass(goalLed(goal.status))}`}
                  style={goal.color ? { backgroundColor: goal.color } : undefined}
                />
                <span className="min-w-0 truncate text-sm font-semibold text-instrument">{goal.name}</span>
                <span className={deck.rowChip}>{goalAreaChipLabel(goal.area)}</span>
              </div>
              <span className={deck.cardMetric}>{`${Math.round(fraction * 100)}%`}</span>
            </div>
            <div className="mt-3">
              <ProgressBar
                pct={fraction}
                status={goalLed(goal.status)}
                label={t("productivity.goalProgressOf", { name: goal.name })}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span>{goalStatusText(goal.status)}</span>
              <span>{linkedTaskText(taskCountsByGoal?.[goal.id])}</span>
              {goal.due_date ? (
                <span>{t("productivity.dueOn", { date: formatShortDate(goal.due_date) })}</span>
              ) : null}
            </div>
            {onEdit || onDelete ? (
              <div className="mt-2 flex flex-wrap items-center justify-end gap-1 border-t border-hair pt-2">
                {onEdit ? (
                  <EditButton
                    label={t("productivity.editGoalLabel", { name: goal.name })}
                    onEdit={() => onEdit(goal)}
                  />
                ) : null}
                {onDelete ? (
                  <DeleteButton
                    label={t("productivity.deleteGoalLabel", { name: goal.name })}
                    pending={deletingId === goal.id}
                    onDelete={() => onDelete(goal)}
                  />
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function TasksList({
  tasks,
  togglingId,
  onToggle,
  onEdit,
  onDelete,
  deletingId,
  goalNameById,
  view,
}: {
  tasks: TaskWire[];
  togglingId: string | null;
  onToggle: (task: TaskWire) => void;
  onEdit?: (task: TaskWire) => void;
  onDelete?: (task: TaskWire) => void;
  deletingId?: string | null;
  goalNameById?: Record<string, string>;
  /** Active date view; a filtered empty list says so instead of a generic empty. */
  view?: TaskDateView;
}) {
  if (tasks.length === 0) {
    if (view && view !== "all") {
      return <EmptyState title={t("productivity.noTasksInView")} />;
    }
    return <EmptyState title={t("productivity.noTasks")} hint={t("productivity.noTasksHint")} />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((task) => {
        const done = task.status === "completed";
        const cancelled = task.status === "cancelled";
        const chip = done || cancelled ? taskStatusText(task.status) : taskPriorityText(task.priority);
        return (
          <li key={task.id} className={deck.cardRow}>
            <div className="flex items-start gap-2">
              <label className="relative flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
                <input
                  type="checkbox"
                  checked={done}
                  disabled={togglingId === task.id}
                  aria-label={
                    done
                      ? t("productivity.reopenTask", { title: task.title })
                      : t("productivity.completeTask", { title: task.title })
                  }
                  onChange={() => onToggle(task)}
                  className={deck.taskToggle}
                />
                <span aria-hidden="true" className={deck.taskToggleMark}>
                  <CheckIcon className="h-3.5 w-3.5" />
                </span>
              </label>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={`min-w-0 flex-1 text-sm ${
                      done ? "text-muted line-through" : "font-medium text-instrument"
                    }`}
                  >
                    {task.title}
                  </span>
                  <span className={deck.rowChip}>{chip}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  {!done && !cancelled ? <span>{taskStatusText(task.status)}</span> : null}
                  {task.goal_id && goalNameById?.[task.goal_id] ? (
                    <span className="min-w-0 truncate">
                      {t("productivity.taskGoalPrefix", { name: goalNameById[task.goal_id] })}
                    </span>
                  ) : null}
                  {task.due_date ? (
                    <span>{t("productivity.dueOn", { date: formatShortDate(task.due_date) })}</span>
                  ) : null}
                </div>
                {onEdit || onDelete ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {onEdit ? (
                      <EditButton
                        label={t("productivity.editTaskLabel", { title: task.title })}
                        onEdit={() => onEdit(task)}
                      />
                    ) : null}
                    {onDelete ? (
                      <DeleteButton
                        label={t("productivity.deleteTaskLabel", { title: task.title })}
                        pending={deletingId === task.id}
                        onDelete={() => onDelete(task)}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function EventsList({
  events,
  onEdit,
  onDelete,
  deletingId,
  view,
}: {
  events: EventWire[];
  onEdit?: (event: EventWire) => void;
  onDelete?: (event: EventWire) => void;
  deletingId?: string | null;
  /** Active time view; a filtered empty list says so instead of a generic empty. */
  view?: EventCardView;
}) {
  if (events.length === 0) {
    if (view && view !== "all") {
      return <EmptyState title={t("productivity.noEventsInView")} />;
    }
    return <EmptyState title={t("productivity.noEvents")} hint={t("productivity.noEventsHint")} />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {events.map((event) => {
        const parts = eventDateParts(event.starts_at);
        return (
          <li key={event.id} className={deck.cardRow}>
            <div className="flex items-start gap-3">
              {parts ? (
                <time dateTime={event.starts_at} className={deck.dateBlock}>
                  <span className={deck.dateBlockMonth}>{parts.month}</span>
                  <span className={deck.dateBlockDay}>{parts.day}</span>
                </time>
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-instrument">{event.title}</span>
                  <span className={deck.rowChip}>{eventKindText(event.kind)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span className="font-mono text-[11px] tabular-nums">{eventTimeRange(event)}</span>
                  {event.location ? <span className="min-w-0 truncate">{event.location}</span> : null}
                </div>
                {onEdit || onDelete ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {onEdit ? (
                      <EditButton
                        label={t("productivity.editEventLabel", { title: event.title })}
                        onEdit={() => onEdit(event)}
                      />
                    ) : null}
                    {onDelete ? (
                      <DeleteButton
                        label={t("productivity.deleteEventLabel", { title: event.title })}
                        pending={deletingId === event.id}
                        onDelete={() => onDelete(event)}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function NotesSearchBox({ query, onQuery }: { query: string; onQuery: (value: string) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-hair bg-deck/60 px-3 transition-colors focus-within:border-signal/50">
      <SearchIcon className="h-4 w-4 shrink-0 text-muted" />
      <input
        type="search"
        role="searchbox"
        aria-label={t("productivity.searchNotes")}
        placeholder={t("productivity.searchNotes")}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        className="min-h-11 w-full bg-transparent text-sm text-instrument placeholder:text-slate-500 focus:outline-none"
      />
    </div>
  );
}

export function NotesResults({
  notes,
  onEdit,
  onDelete,
  onTogglePin,
  deletingId,
  pinningId,
}: {
  notes: NoteWire[];
  onEdit?: (note: NoteWire) => void;
  onDelete?: (note: NoteWire) => void;
  onTogglePin?: (note: NoteWire) => void;
  deletingId?: string | null;
  pinningId?: string | null;
}) {
  if (notes.length === 0) {
    return <EmptyState title={t("productivity.noNotes")} hint={t("productivity.noNotesHint")} />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {notes.map((note) => (
        <li key={note.id} className={deck.cardRow}>
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-instrument">
              {note.title}
            </span>
            {note.is_pinned ? <span className={deck.rowChip}>{t("productivity.pinnedBadge")}</span> : null}
          </div>
          {note.body ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted">{noteExcerpt(note.body)}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-hair pt-2 text-[11px] text-faint">
            <span>{t("productivity.noteUpdatedAt", { date: formatLongDate(note.updated_at) })}</span>
            <div className="flex flex-wrap items-center gap-1">
              {onTogglePin ? (
                <button
                  type="button"
                  disabled={pinningId === note.id}
                  aria-pressed={note.is_pinned}
                  aria-label={
                    note.is_pinned
                      ? t("productivity.unpinNoteLabel", { title: note.title })
                      : t("productivity.pinNoteLabel", { title: note.title })
                  }
                  onClick={() => onTogglePin(note)}
                  className={deck.cardTextAction}
                >
                  {note.is_pinned ? t("productivity.noteUnpin") : t("productivity.notePin")}
                </button>
              ) : null}
              {onEdit ? (
                <EditButton
                  label={t("productivity.editNoteLabel", { title: note.title })}
                  onEdit={() => onEdit(note)}
                />
              ) : null}
              {onDelete ? (
                <DeleteButton
                  label={t("productivity.deleteNoteLabel", { title: note.title })}
                  pending={deletingId === note.id}
                  onDelete={() => onDelete(note)}
                />
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
