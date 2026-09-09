/**
 * Productivity read layer: typed fetchers over `apiFetch`/`apiGet` plus SWR
 * hooks for the productivity screens (`/dashboard/productivity`).
 *
 * Habits carry streak + today status from `GET /habits/today`; quick log
 * actions POST today's log and fall back to PATCH when the log already
 * exists (409). Goals expose trigger-owned `progress` (0-100, never written
 * from the client). Tasks list unfiltered and group client-side. Events use
 * the `from` range bound for the upcoming list. Notes ride the FTS endpoint
 * `GET /notes/search?q=` (blank `q` returns every owned note pinned-first).
 */

import useSWR, { type SWRConfiguration } from "swr";
import { apiDelete, apiFetch, apiGet, apiPost, toApiError } from "@/lib/api/client";

export type HabitLogStatus = "done" | "missed" | "skipped";

export interface HabitTodayWire {
  habit_id: string;
  name: string;
  habit_frequency: string;
  days_of_week: number[];
  current_streak: number;
  today_status: string;
}

export interface GoalWire {
  id: string;
  name: string;
  description: string | null;
  area: string;
  start_date: string;
  due_date: string | null;
  progress: number;
  status: string;
  color: string | null;
}

export interface TaskWire {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  goal_id: string | null;
  sort_order: number;
}

export interface EventWire {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
}

export interface NoteWire {
  id: string;
  title: string;
  body: string;
  is_markdown: boolean;
  is_pinned: boolean;
  updated_at: string;
}

const config: SWRConfiguration = { revalidateOnFocus: false };

export const HABITS_TODAY_KEY = "productivity/habits-today";
export const GOALS_KEY = "productivity/goals";
export const TASKS_KEY = "productivity/tasks";

export function useHabitsToday() {
  return useSWR<HabitTodayWire[]>(HABITS_TODAY_KEY, () => apiGet<HabitTodayWire[]>("/habits/today"), config);
}

export function useGoals() {
  return useSWR<GoalWire[]>(GOALS_KEY, () => apiGet<GoalWire[]>("/goals"), config);
}

export function useTasks() {
  return useSWR<TaskWire[]>(TASKS_KEY, () => apiGet<TaskWire[]>("/tasks"), config);
}

export function eventsKey(from: string | null): string | null {
  return from ? `productivity/events?from=${encodeURIComponent(from)}` : "productivity/events";
}

export function useEvents(from: string | null) {
  const key = eventsKey(from);
  return useSWR<EventWire[]>(
    key,
    () => apiGet<EventWire[]>(from ? `/events?from=${encodeURIComponent(from)}` : "/events"),
    config,
  );
}

export function notesSearchKey(query: string): string {
  return query ? `productivity/notes-search?q=${encodeURIComponent(query)}` : "productivity/notes-search";
}

export function useNotesSearch(query: string) {
  const key = notesSearchKey(query);
  return useSWR<NoteWire[]>(
    key,
    () => apiGet<NoteWire[]>(query ? `/notes/search?q=${encodeURIComponent(query)}` : "/notes/search"),
    config,
  );
}

/**
 * Log today's status for a habit. POSTs the log for `today` (`YYYY-MM-DD`);
 * when the log already exists (409) it PATCHes the same date instead, so a
 * second tap on the same day updates rather than errors.
 */
export async function logHabitToday(
  habitId: string,
  status: HabitLogStatus,
  today: string,
): Promise<void> {
  const res = await apiFetch(`/habits/${habitId}/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ log_date: today, status }),
  });
  if (res.ok) return;
  if (res.status === 409) {
    const patch = await apiFetch(`/habits/${habitId}/logs/${today}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!patch.ok) throw await toApiError(patch);
    return;
  }
  throw await toApiError(res);
}

/** Toggle a task between `completed` and `pending` (reopen). */
export async function patchTaskStatus(taskId: string, status: string): Promise<TaskWire> {
  const res = await apiFetch(`/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as TaskWire;
}

/* -- S2 (Hoy accionable): CRUD mínimo sobre apiPost/apiDelete/apiFetch -- */


function stripEmptyStrings<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    body[key] = value;
  }
  return body;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  priority?: string;
  status?: string;
  due_date?: string | null;
  goal_id?: string | null;
  sort_order?: number;
}

export type UpdateTaskInput = Partial<CreateTaskInput>;

/** Create a task (`POST /tasks`). Title is required; goal travels as id. */
export function createTask(input: CreateTaskInput): Promise<TaskWire> {
  return apiPost<TaskWire>("/tasks", stripEmptyStrings({ ...input }));
}

/** Patch a task (`PATCH /tasks/{id}`). Rejects empty patches upstream (422). */
export async function updateTask(taskId: string, patch: UpdateTaskInput): Promise<TaskWire> {
  const res = await apiFetch(`/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(stripEmptyStrings({ ...patch })),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as TaskWire;
}

/** Delete a task (`DELETE /tasks/{id}`). */
export function deleteTask(taskId: string): Promise<void> {
  return apiDelete(`/tasks/${taskId}`);
}

export interface CreateEventInput {
  title: string;
  description?: string | null;
  kind?: string;
  starts_at: string;
  ends_at?: string | null;
  all_day?: boolean;
  location?: string | null;
}

export type UpdateEventInput = Partial<CreateEventInput>;

/** Create an event (`POST /events`). `starts_at` must be RFC 3339. */
export function createEvent(input: CreateEventInput): Promise<EventWire> {
  return apiPost<EventWire>("/events", stripEmptyStrings({ ...input }));
}

/** Patch an event (`PATCH /events/{id}`). */
export async function updateEvent(eventId: string, patch: UpdateEventInput): Promise<EventWire> {
  const res = await apiFetch(`/events/${eventId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(stripEmptyStrings({ ...patch })),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as EventWire;
}

/** Delete an event (`DELETE /events/{id}`). */
export function deleteEvent(eventId: string): Promise<void> {
  return apiDelete(`/events/${eventId}`);
}

export interface CreateNoteInput {
  title: string;
  body?: string | null;
  is_pinned?: boolean;
}

export type UpdateNoteInput = Partial<CreateNoteInput>;

/** Create a note (`POST /notes`). */
export function createNote(input: CreateNoteInput): Promise<NoteWire> {
  return apiPost<NoteWire>("/notes", stripEmptyStrings({ ...input }));
}

/** Patch a note (`PATCH /notes/{id}`) — also backs pin/unpin. */
export async function updateNote(noteId: string, patch: UpdateNoteInput): Promise<NoteWire> {
  const res = await apiFetch(`/notes/${noteId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(stripEmptyStrings({ ...patch })),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as NoteWire;
}

/** Delete a note (`DELETE /notes/{id}`). */
export function deleteNote(noteId: string): Promise<void> {
  return apiDelete(`/notes/${noteId}`);
}

export interface CreateGoalInput {
  name: string;
  description?: string | null;
  area: string;
  due_date?: string | null;
  status?: string;
  color?: string | null;
}

export type UpdateGoalInput = Partial<CreateGoalInput>;

/** Create a goal (`POST /goals`). `area` picks the category by name. */
export function createGoal(input: CreateGoalInput): Promise<GoalWire> {
  return apiPost<GoalWire>("/goals", stripEmptyStrings({ ...input }));
}

/** Patch a goal (`PATCH /goals/{id}`). Never sends trigger-owned `progress`. */
export async function updateGoal(goalId: string, patch: UpdateGoalInput): Promise<GoalWire> {
  const res = await apiFetch(`/goals/${goalId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(stripEmptyStrings({ ...patch })),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as GoalWire;
}

/** Delete a goal (`DELETE /goals/{id}`). */
export function deleteGoal(goalId: string): Promise<void> {
  return apiDelete(`/goals/${goalId}`);
}
