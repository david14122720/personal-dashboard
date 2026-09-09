"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { t } from "@/lib/i18n";
import {
  createEvent,
  createGoal,
  createNote,
  createTask,
  updateEvent,
  updateGoal,
  updateNote,
  updateTask,
  type EventWire,
  type GoalWire,
  type NoteWire,
  type TaskWire,
} from "@/lib/api/productivity";
import {
  EVENT_KIND_OPTIONS,
  GOAL_AREA_OPTIONS,
  TASK_PRIORITY_OPTIONS,
} from "@/lib/productivity/productivity";

/**
 * S2 manual capture in Spanish, no visible UUIDs. Mirrors the S1
 * `ManualCapture` pattern: plain inputs + selects by name, `apiPost`/PATCH
 * under the hood, Spanish confirm/error states. Goals and tasks link by id
 * internally but the user only ever picks names.
 */

const inputClass =
  "w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument placeholder:text-instrument/40 focus:border-signal focus:outline-none";

function revalidateProductivity(mutate: ReturnType<typeof useSWRConfig>["mutate"]): void {
  void mutate((key) => typeof key === "string" && key.startsWith("productivity/"));
}

function taskPriorityLabel(priority: string): string {
  if (priority === "high") return t("productivity.taskPriorityHigh");
  if (priority === "medium") return t("productivity.taskPriorityMedium");
  if (priority === "low") return t("productivity.taskPriorityLow");
  if (priority === "urgent") return t("productivity.taskPriorityUrgent");
  return priority;
}

function eventKindLabel(kind: string): string {
  if (kind === "appointment") return t("productivity.eventKindAppointment");
  if (kind === "reminder") return t("productivity.eventKindReminder");
  if (kind === "payment_due") return t("productivity.eventKindPaymentDue");
  return t("productivity.eventKindEvent");
}

function goalAreaLabel(area: string): string {
  if (area === "finanzas") return t("productivity.goalAreaFinances");
  if (area === "estudios") return t("productivity.goalAreaStudy");
  if (area === "trabajo") return t("productivity.goalAreaWork");
  if (area === "salud") return t("productivity.goalAreaHealth");
  if (area === "productividad") return t("productivity.goalAreaProductivity");
  if (area === "proyectos") return t("productivity.goalAreaProjects");
  if (area === "lectura") return t("productivity.goalAreaReading");
  if (area === "aprendizaje") return t("productivity.goalAreaLearning");
  return t("productivity.goalAreaOther");
}

function FormStatus({ error, saved }: { error: string | null; saved: boolean }) {
  return (
    <>
      {error ? (
        <p role="alert" className="text-xs text-alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-xs text-flow">
          {t("productivity.saved")}
        </p>
      ) : null}
    </>
  );
}

export interface GoalOption {
  id: string;
  name: string;
}

export function TaskForm({
  goals,
  initial,
  onDone,
}: {
  goals: GoalOption[];
  initial?: TaskWire | null;
  onDone?: () => void;
}) {
  const { mutate } = useSWRConfig();
  const editing = initial?.id ? initial : null;
  const [title, setTitle] = useState(editing?.title ?? "");
  const [priority, setPriority] = useState(editing?.priority ?? "medium");
  const [dueDate, setDueDate] = useState(editing?.due_date ?? "");
  const [goalId, setGoalId] = useState(editing?.goal_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (!title.trim()) {
      setError(t("productivity.requiredError"));
      return;
    }
    setPending(true);
    try {
      const payload = {
        title: title.trim(),
        priority,
        ...(dueDate ? { due_date: dueDate } : {}),
        ...(goalId ? { goal_id: goalId } : {}),
      };
      if (editing) {
        await updateTask(editing.id, payload);
      } else {
        await createTask(payload);
      }
      setSaved(true);
      if (!editing) {
        setTitle("");
        setDueDate("");
        setGoalId("");
      }
      revalidateProductivity(mutate);
    } catch {
      setError(t("productivity.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      aria-label={editing ? t("productivity.editTask") : t("productivity.newTask")}
      className="grid grid-cols-2 gap-3"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <label className="col-span-2 flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.taskTitle")}
        <input
          aria-label={t("productivity.taskTitle")}
          placeholder={t("productivity.taskTitlePlaceholder")}
          className={inputClass}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.taskPriority")}
        <select
          aria-label={t("productivity.taskPriority")}
          className={inputClass}
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
        >
          {TASK_PRIORITY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {taskPriorityLabel(option)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.taskDueDate")}
        <input
          aria-label={t("productivity.taskDueDate")}
          type="date"
          className={inputClass}
          value={dueDate ?? ""}
          onChange={(event) => setDueDate(event.target.value)}
        />
      </label>
      <label className="col-span-2 flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.taskGoal")}
        <select
          aria-label={t("productivity.taskGoal")}
          className={inputClass}
          value={goalId ?? ""}
          onChange={(event) => setGoalId(event.target.value)}
        >
          <option value="">{t("productivity.noGoal")}</option>
          {goals.map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goal.name}
            </option>
          ))}
        </select>
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal disabled:opacity-50"
        >
          {pending ? t("productivity.saving") : editing ? t("productivity.update") : t("productivity.create")}
        </button>
        {editing && onDone ? (
          <button
            type="button"
            onClick={onDone}
            className="rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
          >
            {t("productivity.cancel")}
          </button>
        ) : null}
        <FormStatus error={error} saved={saved} />
      </div>
    </form>
  );
}

export function GoalForm({
  initial,
  onDone,
}: {
  initial?: GoalWire | null;
  onDone?: () => void;
}) {
  const { mutate } = useSWRConfig();
  const editing = initial?.id ? initial : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [area, setArea] = useState(editing?.area ?? "");
  const [dueDate, setDueDate] = useState(editing?.due_date ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (!name.trim() || !area) {
      setError(t("productivity.requiredError"));
      return;
    }
    setPending(true);
    try {
      const payload = {
        name: name.trim(),
        area,
        ...(dueDate ? { due_date: dueDate } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      };
      if (editing) {
        await updateGoal(editing.id, payload);
      } else {
        await createGoal(payload);
      }
      setSaved(true);
      if (!editing) {
        setName("");
        setArea("");
        setDueDate("");
        setDescription("");
      }
      revalidateProductivity(mutate);
    } catch {
      setError(t("productivity.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      aria-label={editing ? t("productivity.editGoal") : t("productivity.newGoal")}
      className="grid grid-cols-2 gap-3"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <label className="col-span-2 flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.goalName")}
        <input
          aria-label={t("productivity.goalName")}
          placeholder={t("productivity.goalNamePlaceholder")}
          className={inputClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.goalArea")}
        <select
          aria-label={t("productivity.goalArea")}
          className={inputClass}
          value={area}
          onChange={(event) => setArea(event.target.value)}
        >
          <option value="">{t("productivity.selectGoalArea")}</option>
          {GOAL_AREA_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {goalAreaLabel(option)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.goalDueDate")}
        <input
          aria-label={t("productivity.goalDueDate")}
          type="date"
          className={inputClass}
          value={dueDate ?? ""}
          onChange={(event) => setDueDate(event.target.value)}
        />
      </label>
      <label className="col-span-2 flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.goalDescription")}
        <input
          aria-label={t("productivity.goalDescription")}
          placeholder={t("productivity.goalDescriptionPlaceholder")}
          className={inputClass}
          value={description ?? ""}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal disabled:opacity-50"
        >
          {pending ? t("productivity.saving") : editing ? t("productivity.update") : t("productivity.create")}
        </button>
        {editing && onDone ? (
          <button
            type="button"
            onClick={onDone}
            className="rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
          >
            {t("productivity.cancel")}
          </button>
        ) : null}
        <FormStatus error={error} saved={saved} />
      </div>
    </form>
  );
}

/** `datetime-local` value (`YYYY-MM-DDTHH:mm`) for the event form. */
export function toDateTimeLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number): string => `${n}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** RFC 3339 (`toISOString`) from a `datetime-local` input, or null when invalid. */
export function fromDateTimeLocalInput(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function EventForm({
  initial,
  onDone,
}: {
  initial?: EventWire | null;
  onDone?: () => void;
}) {
  const { mutate } = useSWRConfig();
  const editing = initial?.id ? initial : null;
  const [title, setTitle] = useState(editing?.title ?? "");
  const [startsAt, setStartsAt] = useState(toDateTimeLocalInput(editing?.starts_at));
  const [kind, setKind] = useState(editing?.kind ?? "event");
  const [location, setLocation] = useState(editing?.location ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const startsAtIso = fromDateTimeLocalInput(startsAt);
    if (!title.trim() || !startsAtIso) {
      setError(t("productivity.requiredError"));
      return;
    }
    setPending(true);
    try {
      const payload = {
        title: title.trim(),
        starts_at: startsAtIso,
        kind,
        ...(location.trim() ? { location: location.trim() } : {}),
      };
      if (editing) {
        await updateEvent(editing.id, payload);
      } else {
        await createEvent(payload);
      }
      setSaved(true);
      if (!editing) {
        setTitle("");
        setStartsAt("");
        setLocation("");
      }
      revalidateProductivity(mutate);
    } catch {
      setError(t("productivity.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      aria-label={editing ? t("productivity.editEvent") : t("productivity.newEvent")}
      className="grid grid-cols-2 gap-3"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <label className="col-span-2 flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.eventTitle")}
        <input
          aria-label={t("productivity.eventTitle")}
          placeholder={t("productivity.eventTitlePlaceholder")}
          className={inputClass}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.eventDate")}
        <input
          aria-label={t("productivity.eventDate")}
          type="datetime-local"
          className={inputClass}
          value={startsAt}
          onChange={(event) => setStartsAt(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.eventKind")}
        <select
          aria-label={t("productivity.eventKind")}
          className={inputClass}
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          {EVENT_KIND_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {eventKindLabel(option)}
            </option>
          ))}
        </select>
      </label>
      <label className="col-span-2 flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.eventLocation")}
        <input
          aria-label={t("productivity.eventLocation")}
          placeholder={t("productivity.eventLocationPlaceholder")}
          className={inputClass}
          value={location ?? ""}
          onChange={(event) => setLocation(event.target.value)}
        />
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal disabled:opacity-50"
        >
          {pending ? t("productivity.saving") : editing ? t("productivity.update") : t("productivity.create")}
        </button>
        {editing && onDone ? (
          <button
            type="button"
            onClick={onDone}
            className="rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
          >
            {t("productivity.cancel")}
          </button>
        ) : null}
        <FormStatus error={error} saved={saved} />
      </div>
    </form>
  );
}

export function NoteForm({
  initial,
  onDone,
}: {
  initial?: NoteWire | null;
  onDone?: () => void;
}) {
  const { mutate } = useSWRConfig();
  const editing = initial?.id ? initial : null;
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [pinned, setPinned] = useState(editing?.is_pinned ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (!title.trim()) {
      setError(t("productivity.requiredError"));
      return;
    }
    setPending(true);
    try {
      const payload = {
        title: title.trim(),
        ...(body.trim() ? { body: body.trim() } : {}),
        is_pinned: pinned,
      };
      if (editing) {
        await updateNote(editing.id, payload);
      } else {
        await createNote(payload);
      }
      setSaved(true);
      if (!editing) {
        setTitle("");
        setBody("");
        setPinned(false);
      }
      revalidateProductivity(mutate);
    } catch {
      setError(t("productivity.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      aria-label={editing ? t("productivity.editNote") : t("productivity.newNote")}
      className="grid grid-cols-2 gap-3"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <label className="col-span-2 flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.noteTitle")}
        <input
          aria-label={t("productivity.noteTitle")}
          placeholder={t("productivity.noteTitlePlaceholder")}
          className={inputClass}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="col-span-2 flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.noteBody")}
        <textarea
          aria-label={t("productivity.noteBody")}
          placeholder={t("productivity.noteBodyPlaceholder")}
          className={inputClass}
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <label className="col-span-2 flex items-center gap-2 text-xs text-instrument/60">
        <input
          type="checkbox"
          aria-label={t("productivity.notePinned")}
          checked={pinned}
          onChange={(event) => setPinned(event.target.checked)}
          className="h-4 w-4 accent-current"
        />
        {t("productivity.notePinned")}
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal disabled:opacity-50"
        >
          {pending ? t("productivity.saving") : editing ? t("productivity.update") : t("productivity.create")}
        </button>
        {editing && onDone ? (
          <button
            type="button"
            onClick={onDone}
            className="rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
          >
            {t("productivity.cancel")}
          </button>
        ) : null}
        <FormStatus error={error} saved={saved} />
      </div>
    </form>
  );
}
