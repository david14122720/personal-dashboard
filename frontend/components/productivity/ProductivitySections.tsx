"use client";

import EmptyState from "@/components/ui/EmptyState";
import HabitsHeatmap from "@/components/ui/HabitsHeatmap";
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
    return <EmptyState title="No habits yet" hint="Create a habit to track streaks here." />;
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
                  aria-label={`${habit.name} status ${habit.today_status}`}
                  title={habit.today_status}
                  className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${ledDotClass(led)}`}
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-medium">{habit.name}</p>
                  <p className="font-mono text-xs tabular-nums text-instrument/60">
                    {habit.current_streak} day streak · {habit.today_status}
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
                      aria-label={`Log ${habit.name} as ${status}`}
                      onClick={() => onLog(habit.habit_id, status)}
                      className="rounded-md border border-hull px-2.5 py-1 font-display text-xs capitalize transition-colors hover:border-signal hover:text-signal disabled:opacity-50"
                    >
                      {status}
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
    return <EmptyState title="No goals yet" hint="Create a goal to track progress here." />;
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
                <span className="ml-2 text-xs font-normal text-instrument/50">{goal.status}</span>
              </p>
              <p className="font-mono text-xs tabular-nums text-instrument/60">
                {Math.round(fraction * 100)}% · {goal.area}
              </p>
            </div>
            {goal.description ? (
              <p className="mt-0.5 truncate text-xs text-instrument/60">{goal.description}</p>
            ) : null}
            <div className="mt-2">
              <ProgressBar pct={fraction} status={goalLed(goal.status)} label={`${goal.name} progress`} />
            </div>
            {goal.due_date ? (
              <p className="mt-1 font-mono text-[11px] tabular-nums text-instrument/60">due {goal.due_date}</p>
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
    return <EmptyState title="No tasks yet" hint="Create a task to see it grouped here." />;
  }
  const groups = groupTasksByStatus(tasks);
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.status}>
          <h3 className="font-display text-xs font-semibold uppercase tracking-widest text-instrument/50">
            {group.status.replace("_", " ")} · {group.items.length}
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
                      {task.priority}
                      {task.due_date ? ` · due ${task.due_date}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={togglingId === task.id}
                    aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
                    aria-pressed={done}
                    onClick={() => onToggle(task)}
                    className="shrink-0 rounded-md border border-hull px-2.5 py-1 font-display text-xs transition-colors hover:border-flow hover:text-flow disabled:opacity-50"
                  >
                    {done ? "Reopen" : "Done"}
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
    return <EmptyState title="No upcoming events" hint="Scheduled events will appear here." />;
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
              {event.kind}
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
      <span className="sr-only">Search notes</span>
      <input
        type="search"
        role="searchbox"
        aria-label="Search notes"
        placeholder="Search notes…"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        className="w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm placeholder:text-instrument/40 focus:border-signal focus:outline-none"
      />
    </label>
  );
}

export function NotesResults({ notes }: { notes: NoteWire[] }) {
  if (notes.length === 0) {
    return <EmptyState title="No notes found" hint="Try a different search term." />;
  }
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {notes.map((note) => (
        <li key={note.id} className="rounded-lg border border-hull px-3 py-2">
          <p className="truncate text-sm font-medium">
            {note.title}
            {note.is_pinned ? (
              <span className="ml-2 rounded-full border border-signal/40 px-2 py-0.5 font-display text-[11px] text-signal">
                pinned
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
