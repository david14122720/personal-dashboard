"use client";

import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import AppShell from "@/components/layout/AppShell";
import {
  EventsList,
  GoalsList,
  HabitsList,
  NotesResults,
  NotesSearchBox,
  SectionShell,
  TasksList,
} from "@/components/productivity/ProductivitySections";
import {
  GOALS_KEY,
  HABITS_TODAY_KEY,
  TASKS_KEY,
  logHabitToday,
  patchTaskStatus,
  useEvents,
  useGoals,
  useHabitsToday,
  useNotesSearch,
  useTasks,
  type HabitLogStatus,
  type TaskWire,
} from "@/lib/api/productivity";
import { toISODate } from "@/lib/dashboard/transforms";

/**
 * Productivity screens container. Owns all SWR reads (fired in parallel),
 * the debounced notes query, and the habit-log / task-toggle mutations;
 * `components/productivity/*` sections stay pure.
 */

function SectionsSkeleton() {
  return (
    <div role="status" aria-label="Loading productivity sections" aria-busy="true" className="grid grid-cols-12 gap-4">
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

export default function ProductivityScreens() {
  const { mutate } = useSWRConfig();
  const [query, setQuery] = useState("");
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
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

  function retry() {
    void mutate((key) => typeof key === "string" && key.startsWith("productivity/"));
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-wide">Productivity</h1>
      <p className="mt-1 text-sm text-instrument/60">Habits, goals, tasks, events, and notes.</p>
      <div className="mt-6 grid grid-cols-12 gap-4">
        {isLoading ? (
          <div className="col-span-12">
            <SectionsSkeleton />
          </div>
        ) : failed.length > 0 ? (
          <div className="col-span-12">
            <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-5">
              <h2 className="font-display text-lg font-semibold">Productivity sections failed to load</h2>
              <p className="mt-1 text-sm text-instrument/70">
                {failed.length} of {queries.length} sections failed. Check your connection and retry.
              </p>
              <button
                type="button"
                onClick={retry}
                className="mt-4 rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
              >
                Retry
              </button>
            </div>
          </div>
        ) : (
          <>
            <SectionShell
              title="Habits"
              hint="Today's status, streaks, and quick log actions."
              span="col-span-12 xl:col-span-7"
            >
              <HabitsList habits={habits.data ?? []} loggingId={loggingId} onLog={(id, s) => void handleLog(id, s)} />
            </SectionShell>
            <SectionShell
              title="Goals"
              hint="Progress derives from linked tasks."
              span="col-span-12 xl:col-span-5"
            >
              <GoalsList goals={goals.data ?? []} />
            </SectionShell>
            <SectionShell
              title="Tasks"
              hint="Grouped by status; toggling a task refreshes goal progress."
              span="col-span-12 md:col-span-6 xl:col-span-4"
            >
              <TasksList tasks={tasks.data ?? []} togglingId={togglingId} onToggle={(t) => void handleToggle(t)} />
            </SectionShell>
            <SectionShell title="Events" hint="Upcoming schedule." span="col-span-12 md:col-span-6 xl:col-span-4">
              <EventsList events={events.data ?? []} />
            </SectionShell>
            <SectionShell title="Notes" hint="Full-text search." span="col-span-12 xl:col-span-4">
              <NotesSearchBox query={query} onQuery={setQuery} />
              <NotesResults notes={notes.data ?? []} />
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
