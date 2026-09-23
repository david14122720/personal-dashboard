"use client";

import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import AppShell from "@/components/layout/AppShell";
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
 * the debounced notes query, and the task-toggle mutations;
 * `components/productivity/*` sections stay pure.
 *
 * S2 adds manual CRUD forms (Spanish, selects by name, never raw UUIDs),
 * date-based task views (Hoy / Próximas / Vencidas / Completadas) and event
 * time views (Próximos / Vencidos).
 *
 * Habits live only in `/dashboard/habitos/` (`HabitsDashboard` +
 * `HabitGrid`); this screen owns goals/tasks/events/notes.
 */

function SectionsSkeleton() {
  const spans = [
    "col-span-12 xl:col-span-6",
    "col-span-12 md:col-span-6 xl:col-span-6",
    "col-span-12 md:col-span-6 xl:col-span-6",
    "col-span-12 xl:col-span-6",
  ];
  return (
    <div role="status" aria-label={t("productivity.loadingSections")} aria-busy="true" className="grid grid-cols-12 gap-6">
      {spans.map((span, index) => (
        <div
          key={`${span}-${index}`}
          className={`animate-pulse rounded-xl border border-hull bg-hull/40 p-5 ${span}`}
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

type ProductivitySectionId = "goals" | "tasks" | "events" | "notes";

const FORM_IDS: Record<ProductivitySectionId, string> = {
  goals: "productivity-form-goals",
  tasks: "productivity-form-tasks",
  events: "productivity-form-events",
  notes: "productivity-form-notes",
};

export default function ProductivityScreens() {
  const { mutate } = useSWRConfig();
  const [query, setQuery] = useState("");
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
  /** Collapsed-form state machine: at most one section form open at a time.
   * `null` renders the four lists with their «Nuevo» toggles and no form. */
  const [openSection, setOpenSection] = useState<ProductivitySectionId | null>(null);
  const toggleRefs = useRef<Record<ProductivitySectionId, HTMLButtonElement | null>>({
    goals: null,
    tasks: null,
    events: null,
    notes: null,
  });
  const prevOpenRef = useRef<ProductivitySectionId | null>(null);
  const [eventsFrom] = useState(() => new Date().toISOString());
  const debouncedQuery = useDebouncedValue(query.trim());

  const goals = useGoals();
  const tasks = useTasks();
  const events = useEvents(eventsFrom);
  const notes = useNotesSearch(debouncedQuery);

  const queries = [goals, tasks, events, notes];
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

  return (
    <div>
      <h1 className="flex items-center gap-3 font-display text-2xl font-semibold tracking-wide">
        {t("productivity.title")}
        <span className="rounded-full border border-signal/20 bg-signal/10 px-2.5 py-0.5 font-mono text-xs font-medium text-signal">
          {t("productivity.focusBadge")}
        </span>
      </h1>
      <p className="mt-1 text-sm text-instrument/60">{t("productivity.subtitle")}</p>
      {actionError ? (
        <p role="alert" className="mt-4 rounded-xl border border-alert/50 bg-alert/10 p-4 text-sm">
          {actionError}
        </p>
      ) : null}
      <div className="mt-6 grid grid-cols-12 gap-6">
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
              title={t("productivity.goals")}
              hint={t("productivity.goalsHint")}
              span="col-span-12 xl:col-span-6"
              action={
                <NewEntryButton
                  ref={(el) => {
                    toggleRefs.current.goals = el;
                  }}
                  section={t("productivity.goals")}
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
                deletingId={deletingId}
                onEdit={(goal) => {
                  setEditingGoal(goal);
                  openForm("goals");
                }}
                onDelete={(goal) => void handleDeleteGoal(goal)}
              />
            </SectionShell>
            <SectionShell
              title={t("productivity.tasks")}
              hint={t("productivity.tasksHint")}
              span="col-span-12 md:col-span-6 xl:col-span-6"
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
            <SectionShell title={t("productivity.events")} hint={t("productivity.eventsHint")} span="col-span-12 md:col-span-6 xl:col-span-6"
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
                deletingId={deletingId}
                onEdit={(event) => {
                  setEditingEvent(event);
                  openForm("events");
                }}
                onDelete={(event) => void handleDeleteEvent(event)}
              />
            </SectionShell>
            <SectionShell title={t("productivity.notes")} hint={t("productivity.notesHint")} span="col-span-12 xl:col-span-6"
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
