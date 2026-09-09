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

export const HEATMAP_DAYS = 14;

/**
 * Derive a fixed-width heatmap strip (oldest → newest) from a habit's
 * streak. The backend exposes no per-day log history on this read, so the
 * strip renders `current_streak` trailing completions with the last cell
 * pinned to `today_status`: a done today extends the run, a missed today
 * breaks it, a pending today waits, and a skipped day stays neutral.
 */
export function heatmapCells(
  streak: number,
  todayStatus: string,
  days: number = HEATMAP_DAYS,
): HeatCell[] {
  const cells: HeatCell[] = new Array(days).fill("empty");
  if (days <= 0) return cells;
  const run = Math.min(Math.max(Math.floor(streak), 0), days);
  const doneBefore = todayStatus === "done" ? Math.max(run - 1, 0) : run;
  for (let i = 0; i < doneBefore; i += 1) {
    cells[days - 2 - i] = "done";
  }
  const last = days - 1;
  if (todayStatus === "done") cells[last] = "done";
  else if (todayStatus === "missed") cells[last] = "missed";
  else if (todayStatus === "pending") cells[last] = "pending";
  return cells;
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
