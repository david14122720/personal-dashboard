/**
 * Habit-history transform boundary. Pure helpers over `GET /habits/logs`
 * range rows — containers own SWR reads, UI receives these views.
 * Mirrors `lib/dashboard/transforms.ts`: no fetch, no parsing of money.
 */

export interface HabitLogEntry { habit_id: string; log_date: string; status: string; }

export interface HabitStats {
  total: number; done: number; missed: number; skipped: number; unlogged: number;
  complianceRate: number; bestStreak: number; currentStreak: number;
}

export type CalendarState = "cumplido" | "no-cumplido" | "omitido" | "sin-registro";
export interface CalendarCell { date: string; state: CalendarState; }
export type EvolutionGranularity = "week" | "month" | "year";
export interface EvolutionSeries { name: string; points: Array<{ bucket: string; done: number }>; }

const DAY_MS = 86_400_000;
const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const toMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);
// JS getUTCDay matches BE EXTRACT(DOW): 0=Sun..6=Sat.
const dow = (ms: number): number => new Date(ms).getUTCDay();
const isDone = (s: string): boolean => s === "done";
const isSkip = (s: string): boolean => s === "skipped";
const isBreak = (s: string): boolean => s === "missed" || s === "not_done";

/** done / denom as 0..100 with 1 decimal; zero denom maps to 0. */
export function complianceRate(done: number, denom: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(denom) || denom <= 0) return 0;
  return Math.round((Math.max(0, done) / denom) * 1000) / 10;
}

function scheduledDays(from: string, to: string, daysOfWeek?: number[]): number[] {
  const mask = daysOfWeek && daysOfWeek.length > 0 ? new Set(daysOfWeek) : null;
  const days: number[] = [];
  for (let ms = toMs(from); ms <= toMs(to); ms += DAY_MS) {
    if (!mask || mask.has(dow(ms))) days.push(ms);
  }
  return days;
}

/** Stats over scheduled days. `skipped` bridges streaks; `missed`/`not_done`/absence breaks them. */
export function habitStats(logs: HabitLogEntry[], from: string, to: string, daysOfWeek?: number[]): HabitStats {
  const byDate = new Map<string, string>();
  for (const entry of logs) byDate.set(entry.log_date, entry.status);
  const days = scheduledDays(from, to, daysOfWeek);
  const slots = days.map((ms) => byDate.get(ymd(ms))); // undefined = sin registro
  let done = 0, missed = 0, skipped = 0, unlogged = 0, best = 0, run = 0;
  for (const status of slots) {
    if (status === undefined) { unlogged += 1; best = Math.max(best, run); run = 0; continue; }
    if (isDone(status)) { done += 1; run += 1; best = Math.max(best, run); }
    else if (isSkip(status)) { skipped += 1; } // puente: ni crece ni rompe
    else { missed += 1; best = Math.max(best, run); run = 0; } // missed + legacy not_done
  }
  // Racha actual: salta el sufijo sin registro (hoy aún no registrado),
  // luego cuenta hacia atrás puenteando skipped hasta el primer corte.
  let current = 0;
  let i = slots.length - 1;
  while (i >= 0 && slots[i] === undefined) i -= 1;
  for (; i >= 0; i -= 1) {
    const status = slots[i] as string;
    if (isDone(status)) current += 1;
    else if (!isSkip(status)) break;
  }
  const total = done + missed + skipped + unlogged;
  return { total, done, missed, skipped, unlogged, complianceRate: complianceRate(done, total - skipped), bestStreak: best, currentStreak: current };
}

function stateFor(status: string | undefined): CalendarState {
  if (status === undefined) return "sin-registro";
  if (isDone(status)) return "cumplido";
  if (isSkip(status)) return "omitido";
  return "no-cumplido"; // missed + legacy not_done
}

/** 42 cells (6 weeks, Monday-first) for `monthKey` YYYY-MM from real logs. */
export function logsToCalendarCells(logs: HabitLogEntry[], habitId: string, monthKey: string): CalendarCell[] {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return [];
  const first = Date.UTC(Number(match[1]), Number(match[2]) - 1, 1);
  const leading = (new Date(first).getUTCDay() + 6) % 7; // Monday-first offset
  const byDate = new Map<string, string>();
  for (const entry of logs) {
    if (entry.habit_id === habitId) byDate.set(entry.log_date, entry.status);
  }
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = ymd(first + (i - leading) * DAY_MS);
    cells.push({ date, state: stateFor(byDate.get(date)) });
  }
  return cells;
}

/** Map the 4-state calendar onto the shared HeatCell palette (real logs only). */
export function calendarStateToHeat(state: CalendarState): "done" | "missed" | "pending" | "empty" {
  switch (state) {
    case "cumplido": return "done";
    case "no-cumplido": return "missed";
    case "sin-registro": return "pending";
    case "omitido": return "empty";
  }
}

function bucketFor(logDate: string, granularity: EvolutionGranularity): string {
  if (granularity === "month") return logDate.slice(0, 7);
  if (granularity === "year") return logDate.slice(0, 4);
  const ms = toMs(logDate);
  return ymd(ms - ((dow(ms) + 6) % 7) * DAY_MS); // week buckets keyed by Monday
}

/** Per-habit done-counts bucketed by week (Monday), month or year, sorted. Names label series. */
export function aggregateEvolution(
  logs: HabitLogEntry[],
  habits: Array<{ id: string; name: string }>,
  granularity: EvolutionGranularity,
): EvolutionSeries[] {
  return habits.map(({ id, name }) => {
    const counts = new Map<string, number>();
    for (const entry of logs) {
      if (entry.habit_id !== id || !isDone(entry.status)) continue;
      const bucket = bucketFor(entry.log_date, granularity);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    const points = [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([bucket, doneCount]) => ({ bucket, done: doneCount }));
    return { name, points };
  });
}
