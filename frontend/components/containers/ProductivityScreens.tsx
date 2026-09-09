"use client";

import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import AppShell from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import {
  EventsList,
  EventViewTabs,
  GoalsList,
  HabitsList,
  NotesResults,
  NotesSearchBox,
  SectionShell,
  TasksList,
  TaskViewTabs,
} from "@/components/productivity/ProductivitySections";
import {
  EventForm,
  GoalForm,
  NoteForm,
  TaskForm,
} from "@/components/productivity/ProductivityForms";
import {
  GOALS_KEY,
  HABITS_TODAY_KEY,
  TASKS_KEY,
  deleteEvent,
  deleteGoal,
  deleteNote,
  deleteTask,
  logHabitToday,
  patchTaskStatus,
  updateNote,
  useEvents,
  useGoals,
  useHabitsToday,
  useNotesSearch,
  useTasks,
  type EventWire,
  type GoalWire,
  type HabitLogStatus,
  type NoteWire,
  type TaskWire,
} from "@/lib/api/productivity";
import {
  countEventsByTimeView,
  countTasksByDateView,
  filterEventsByTimeView,
  filterTasksByDateView,
  type EventTimeView,
  type TaskDateView,
} from "@/lib/productivity/productivity";
import { toISODate } from "@/lib/dashboard/transforms";

/**
 * Productivity screens container. Owns all SWR reads (fired in parallel),
 * the debounced notes query, and the habit-log / task-toggle mutations;
 * `components/productivity/*` sections stay pure.
 *
 * S2 adds manual CRUD forms (Spanish, selects by name, never raw UUIDs),
 * date-based task views (Hoy / Próximas / Vencidas / Completadas), event
 * time views (Próximos / Vencidos), and a habits-calendar shortcut that
 * reserves the S7 anchor without changing the S1 check-in flow.
 */

function SectionsSkeleton() {
  return (
    <div role="status" aria-label={t("productivity.loadingSections")} aria-busy="true" className="grid grid-cols-12 gap-4">
      {[0, 1, 2].map((n) => (
        <div
          key={n}
          className="col-span-12 animate-pulse rounded-xl border border-hull bg-hull/40 p-5 md:col-span-6"
        >
          <div className="h-4 w-24 rounded bg-hull" />
          <div className="mt-3 h-8 w-32 rounded bg-hull" />
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

export default function ProductivityScreens() {
  const { mutate } = useSWRConfig();
  const [query, setQuery] = useState("");
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [taskView, setTaskView] = useState<TaskDateView>("all");
  const [eventView, setEventView] = useState<EventTimeView>("all");
  const [editingTask, setEditingTask] = useState<TaskWire | null>(null);
  const [editingGoal, setEditingGoal] = useState<GoalWire | null>(null);
  const [editingEvent, setEditingEvent] = useState<EventWire | null>(null);
  const [editingNote, setEditingNote] = useState<NoteWire | null>(null);
  const [eventsFrom] = useState(() => new Date().toISOString());
  const debouncedQuery = useDebouncedValue(query.trim());

  const habits = useHabitsToday();
  const goals = useGoals();
  const tasks = useTasks();
  const events = useEvents(eventsFrom);
  const notes = useNotesSearch(debouncedQuery);

  const queries = [habits, goals, tasks, events, notes];
  const isLoading = queries.some((q) => q.isLoading);
  const failed = queries.filter((q) => q.error);

  const todayYmd = toISODate(new Date());
  const nowMs = Date.now();
  const allTasks = tasks.data ?? [];
  const visibleTasks = filterTasksByDateView(allTasks, taskView, todayYmd);
  const taskCounts = countTasksByDateView(allTasks, todayYmd);
  const allEvents = events.data ?? [];
  const visibleEvents = filterEventsByTimeView(allEvents, eventView, nowMs);
  const eventCounts = countEventsByTimeView(allEvents, nowMs);
  const goalOptions = (goals.data ?? []).map((goal) => ({ id: goal.id, name: goal.name }));
  const goalNameById: Record<string, string> = Object.fromEntries(
    goalOptions.map((goal) => [goal.id, goal.name]),
  );

  async function handleLog(habitId: string, status: HabitLogStatus) {
    setLoggingId(habitId);
    try {
      await logHabitToday(habitId, status, toISODate());
      await mutate(HABITS_TODAY_KEY);
    } finally {
      setLoggingId(null);
    }
  }

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

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-wide">{t("productivity.title")}</h1>
      <p className="mt-1 text-sm text-instrument/60">{t("productivity.subtitle")}</p>
      {actionError ? (
        <p role="alert" className="mt-4 rounded-xl border border-alert/50 bg-alert/10 p-4 text-sm">
          {actionError}
        </p>
      ) : null}
      <div className="mt-6 grid grid-cols-12 gap-4">
        {isLoading ? (
          <div className="col-span-12">
            <SectionsSkeleton />
          </div>
        ) : failed.length > 0 ? (
          <div className="col-span-12">
            <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-5">
              <h2 className="font-display text-lg font-semibold">{t("productivity.loadFailed")}</h2>
              <p className="mt-1 text-sm text-instrument/70">
                {t("productivity.loadFailedDetail", { failed: failed.length, total: queries.length })}
              </p>
              <button
                type="button"
                onClick={retry}
                className="mt-4 rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
              >
                {t("common.retry")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <SectionShell
              title={t("productivity.habits")}
              hint={t("productivity.habitsHint")}
              span="col-span-12 xl:col-span-7"
            >
              <HabitsList habits={habits.data ?? []} loggingId={loggingId} onLog={(id, s) => void handleLog(id, s)} />
              <div id="calendario-habitos">
                <p className="mt-3 text-xs text-instrument/60">
                  <a
                    href="#calendario-habitos"
                    className="underline decoration-dotted underline-offset-2 transition-colors hover:text-signal"
                  >
                    {t("productivity.habitsCalendarLink")}
                  </a>
                  {" · "}
                  {t("productivity.habitsCalendarHint")}
                </p>
              </div>
            </SectionShell>
            <SectionShell
              title={t("productivity.goals")}
              hint={t("productivity.goalsHint")}
              span="col-span-12 xl:col-span-5"
            >
              <GoalForm
                key={editingGoal ? `edit-${editingGoal.id}` : "new-goal"}
                initial={editingGoal}
                onDone={() => setEditingGoal(null)}
              />
              <div className="mt-4">
                <GoalsList
                  goals={goals.data ?? []}
                  deletingId={deletingId}
                  onEdit={(goal) => setEditingGoal(goal)}
                  onDelete={(goal) => void handleDeleteGoal(goal)}
                />
              </div>
            </SectionShell>
            <SectionShell
              title={t("productivity.tasks")}
              hint={t("productivity.tasksHint")}
              span="col-span-12 md:col-span-6 xl:col-span-4"
            >
              <TaskForm
                key={editingTask ? `edit-${editingTask.id}` : "new-task"}
                goals={goalOptions}
                initial={editingTask}
                onDone={() => setEditingTask(null)}
              />
              <div className="mt-4">
                <TaskViewTabs view={taskView} counts={taskCounts} onView={setTaskView} />
                <TasksList
                  tasks={visibleTasks}
                  togglingId={togglingId}
                  onToggle={(t) => void handleToggle(t)}
                  deletingId={deletingId}
                  goalNameById={goalNameById}
                  onEdit={(task) => setEditingTask(task)}
                  onDelete={(task) => void handleDeleteTask(task)}
                />
              </div>
            </SectionShell>
            <SectionShell title={t("productivity.events")} hint={t("productivity.eventsHint")} span="col-span-12 md:col-span-6 xl:col-span-4">
              <EventForm
                key={editingEvent ? `edit-${editingEvent.id}` : "new-event"}
                initial={editingEvent}
                onDone={() => setEditingEvent(null)}
              />
              <div className="mt-4">
                <EventViewTabs view={eventView} counts={eventCounts} onView={setEventView} />
                <EventsList
                  events={visibleEvents}
                  deletingId={deletingId}
                  onEdit={(event) => setEditingEvent(event)}
                  onDelete={(event) => void handleDeleteEvent(event)}
                />
              </div>
            </SectionShell>
            <SectionShell title={t("productivity.notes")} hint={t("productivity.notesHint")} span="col-span-12 xl:col-span-4">
              <NoteForm
                key={editingNote ? `edit-${editingNote.id}` : "new-note"}
                initial={editingNote}
                onDone={() => setEditingNote(null)}
              />
              <div className="mt-4">
                <NotesSearchBox query={query} onQuery={setQuery} />
              </div>
              <NotesResults
                notes={notes.data ?? []}
                deletingId={deletingId}
                pinningId={pinningId}
                onEdit={(note) => setEditingNote(note)}
                onDelete={(note) => void handleDeleteNote(note)}
                onTogglePin={(note) => void handleTogglePin(note)}
              />
            </SectionShell>
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
