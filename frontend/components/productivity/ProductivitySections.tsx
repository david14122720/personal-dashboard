"use client";

import EmptyState from "@/components/ui/EmptyState";
import HabitsHeatmap from "@/components/ui/HabitsHeatmap";
import { t } from "@/lib/i18n";
import type { EventWire, GoalWire, HabitTodayWire, NoteWire, TaskWire } from "@/lib/api/productivity";
import { ledDotClass } from "@/lib/dashboard/transforms";
import {
  eventWhenLabel,
  goalProgressFraction,
  groupTasksByStatus,
  habitStatusLed,
  heatmapCells,
  noteExcerpt,
} from "@/lib/productivity/productivity";

/**
 * Pure presentational sections for the productivity screens. The container
 * owns all SWR reads, debounced search state, and log/toggle mutations;
 * these components receive plain views and callbacks only.
 */

export function SectionShell({
  title,
  hint,
  children,
  span,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  span: string;
}) {
  return (
    <section aria-label={title} className={`rounded-xl border border-hull bg-hull/40 p-5 ${span}`}>
      <h2 className="font-display text-base font-semibold tracking-wide">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-instrument/60">{hint}</p> : null}
      <div className="mt-4">{children}</div>
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
      className="h-2 overflow-hidden rounded-full bg-deck"
    >
      <div className={`h-full rounded-full ${ledDotClass(status)}`} style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

function habitStatusText(status: string): string {
  if (status === "done") return t("productivity.habitStatusDone");
  if (status === "missed") return t("productivity.habitStatusMissed");
  if (status === "skipped") return t("productivity.habitStatusSkipped");
  return t("productivity.habitStatusPending");
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

export function HabitsList({
  habits,
  loggingId,
  onLog,
}: {
  habits: HabitTodayWire[];
  loggingId: string | null;
  onLog: (habitId: string, status: "done" | "missed" | "skipped") => void;
}) {
  if (habits.length === 0) {
    return <EmptyState title={t("productivity.noHabits")} hint={t("productivity.noHabitsHint")} />;
  }
  return (
    <ul className="flex flex-col gap-3">
      {habits.map((habit) => {
        const led = habitStatusLed(habit.today_status);
        const isLogging = loggingId === habit.habit_id;
        return (
          <li key={habit.habit_id} className="rounded-lg border border-hull px-4 py-3">
            <div className="flex items-start gap-2.5">
              {led ? (
                <span
                  role="img"
                  aria-label={t("productivity.habitStatusLabel", {
                    name: habit.name,
                    status: habitStatusText(habit.today_status),
                  })}
                  title={habitStatusText(habit.today_status)}
                  className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${ledDotClass(led)}`}
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-medium">{habit.name}</p>
                  <p className="font-mono text-xs tabular-nums text-instrument/60">
                    {t("productivity.streakDetail", {
                      n: habit.current_streak,
                      status: habitStatusText(habit.today_status),
                    })}
                  </p>
                </div>
                <div className="mt-2">
                  <HabitsHeatmap cells={heatmapCells(habit.current_streak, habit.today_status)} label={habit.name} />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(["done", "missed", "skipped"] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      disabled={isLogging}
                      aria-label={t("productivity.logHabitAs", {
                        name: habit.name,
                        status: habitStatusText(status),
                      })}
                      onClick={() => onLog(habit.habit_id, status)}
                      className="rounded-md border border-hull px-2.5 py-1 font-display text-xs capitalize transition-colors hover:border-signal hover:text-signal disabled:opacity-50"
                    >
                      {habitStatusText(status)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function goalLed(status: string): string {
  if (status === "completed") return "ok";
  if (status === "paused") return "warn";
  if (status === "cancelled") return "over";
  return "ok";
}

export function GoalsList({ goals }: { goals: GoalWire[] }) {
  if (goals.length === 0) {
    return <EmptyState title={t("productivity.noGoals")} hint={t("productivity.noGoalsHint")} />;
  }
  return (
    <ul className="flex flex-col gap-3">
      {goals.map((goal) => {
        const fraction = goalProgressFraction(goal.progress);
        return (
          <li key={goal.id} className="rounded-lg border border-hull px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="truncate text-sm font-medium">
                {goal.name}
                <span className="ml-2 text-xs font-normal text-instrument/50">{goalStatusText(goal.status)}</span>
              </p>
              <p className="font-mono text-xs tabular-nums text-instrument/60">
                {Math.round(fraction * 100)}% · {goal.area}
              </p>
            </div>
            {goal.description ? (
              <p className="mt-0.5 truncate text-xs text-instrument/60">{goal.description}</p>
            ) : null}
            <div className="mt-2">
              <ProgressBar pct={fraction} status={goalLed(goal.status)} label={t("productivity.goalProgressOf", { name: goal.name })} />
            </div>
            {goal.due_date ? (
              <p className="mt-1 font-mono text-[11px] tabular-nums text-instrument/60">{t("productivity.dueOn", { date: goal.due_date })}</p>
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
}: {
  tasks: TaskWire[];
  togglingId: string | null;
  onToggle: (task: TaskWire) => void;
}) {
  if (tasks.length === 0) {
    return <EmptyState title={t("productivity.noTasks")} hint={t("productivity.noTasksHint")} />;
  }
  const groups = groupTasksByStatus(tasks);
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.status}>
          <h3 className="font-display text-xs font-semibold uppercase tracking-widest text-instrument/50">
            {t("productivity.taskGroupCount", { status: taskStatusText(group.status), n: group.items.length })}
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {group.items.map((task) => {
              const done = task.status === "completed";
              return (
                <li
                  key={task.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-hull px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{task.title}</p>
                    <p className="truncate text-xs text-instrument/60">
                      {taskPriorityText(task.priority)}
                      {task.due_date ? ` · ${t("productivity.dueOn", { date: task.due_date })}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={togglingId === task.id}
                    aria-label={done ? t("productivity.reopenTask", { title: task.title }) : t("productivity.completeTask", { title: task.title })}
                    aria-pressed={done}
                    onClick={() => onToggle(task)}
                    className="shrink-0 rounded-md border border-hull px-2.5 py-1 font-display text-xs transition-colors hover:border-flow hover:text-flow disabled:opacity-50"
                  >
                    {done ? t("productivity.markReopen") : t("productivity.markDone")}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function EventsList({ events }: { events: EventWire[] }) {
  if (events.length === 0) {
    return <EmptyState title={t("productivity.noEvents")} hint={t("productivity.noEventsHint")} />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {events.map((event) => (
        <li
          key={event.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-hull px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate text-sm">{event.title}</p>
            <p className="truncate text-xs text-instrument/60">
              {eventKindText(event.kind)}
              {event.location ? ` · ${event.location}` : ""}
            </p>
          </div>
          <p className="shrink-0 font-mono text-xs tabular-nums text-instrument/70">
            {eventWhenLabel(event.starts_at, event.all_day)}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function NotesSearchBox({ query, onQuery }: { query: string; onQuery: (value: string) => void }) {
  return (
    <label className="block">
      <span className="sr-only">{t("productivity.searchNotes")}</span>
      <input
        type="search"
        role="searchbox"
        aria-label={t("productivity.searchNotes")}
        placeholder={t("productivity.searchNotes")}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        className="w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm placeholder:text-instrument/40 focus:border-signal focus:outline-none"
      />
    </label>
  );
}

export function NotesResults({ notes }: { notes: NoteWire[] }) {
  if (notes.length === 0) {
    return <EmptyState title={t("productivity.noNotes")} hint={t("productivity.noNotesHint")} />;
  }
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {notes.map((note) => (
        <li key={note.id} className="rounded-lg border border-hull px-3 py-2">
          <p className="truncate text-sm font-medium">
            {note.title}
            {note.is_pinned ? (
              <span className="ml-2 rounded-full border border-signal/40 px-2 py-0.5 font-display text-[11px] text-signal">
                {t("productivity.pinnedBadge")}
              </span>
            ) : null}
          </p>
          {note.body ? (
            <p className="mt-0.5 truncate text-xs text-instrument/60">{noteExcerpt(note.body)}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
