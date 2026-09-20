/**
 * Habit-dashboard calculations (spec §10). Pure helpers over local
 * `YYYY-MM-DD` dates — no fetch, no React, no clock reads. Callers pass the
 * user's local "today" explicitly.
 *
 * Date handling mirrors `habitStats.ts`: UTC-midnight parse + `getUTCDay`
 * (0=Sun..6=Sat, the backend `EXTRACT(DOW)` convention).
 */

export interface DashHabit {
  id: string;
  name: string;
  direction: string;
  frequency: string;
  daysOfWeek: number[];
  startDate: string;
  endDate: string | null;
  category: string | null;
  shortLabel: string | null;
  isArchived: boolean;
}

export interface DashLog {
  habitId: string;
  date: string;
  status: string;
}

export interface MonthlyCompliance {
  pct: number;
  done: number;
  expected: number;
}

export interface LongestStreak {
  days: number;
  habitNames: string[];
}

export interface TodayCompletion {
  done: number;
  total: number;
}

export interface WeekdayConsistency {
  values: number[];
  avg: number;
  best: { index: number; pct: number };
}

export type Milestone =
  | { kind: "category"; category: string }
  | { kind: "streak"; habitName: string; days: number };

export interface ReflectionInsight {
  habitName: string;
  points: number;
}

/** Monthly target behind the KPI footer (`Meta mensual: 80%`). */
export const MONTHLY_GOAL_PCT = 80;

const DAY_MS = 86_400_000;
const XP_PER_DONE = 10;
const XP_PER_LEVEL = 500;

const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const toMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const dow = (ms: number): number => new Date(ms).getUTCDay();
const isDone = (status: string): boolean => status === "done";
const round1 = (value: number): number => Math.round(value * 10) / 10;
const pctOf = (done: number, expected: number): number =>
  expected > 0 ? round1((done / expected) * 100) : 0;
const pairKey = (habitId: string, date: string): string => `${habitId}|${date}`;

/** Empty mask = every day; otherwise only masked weekdays (same as `isScheduled`). */
function maskMatches(habit: DashHabit, date: string): boolean {
  const mask = habit.daysOfWeek;
  if (!mask || mask.length === 0) return true;
  return mask.includes(dow(toMs(date)));
}

function donePairsOf(logs: DashLog[]): Set<string> {
  const pairs = new Set<string>();
  for (const entry of logs) {
    if (isDone(entry.status)) pairs.add(pairKey(entry.habitId, entry.date));
  }
  return pairs;
}

/** Every `YYYY-MM-DD` of `monthKey` (`YYYY-MM`), sorted. Empty for bad keys. */
export function monthDays(monthKey: string): string[] {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return [];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days: string[] = [];
  for (let day = 1; day <= lastDay; day += 1) days.push(ymd(Date.UTC(year, month - 1, day)));
  return days;
}

/** Whether `date` counts toward `habit`: inside its range, not after today and mask-scheduled. */
export function isExpected(habit: DashHabit, date: string, todayYmd: string): boolean {
  if (date > todayYmd) return false;
  if (habit.startDate && date < habit.startDate) return false;
  if (habit.endDate && date > habit.endDate) return false;
  return maskMatches(habit, date);
}

/** Expected days of `monthKey` for `habit`: current month capped at `todayYmd`, `[]` for future months. */
export function expectedDates(habit: DashHabit, monthKey: string, todayYmd: string): string[] {
  if (monthKey > todayYmd.slice(0, 7)) return [];
  return monthDays(monthKey).filter((date) => isExpected(habit, date, todayYmd));
}

/**
 * Habits that count on `monthKey`: not archived and their range overlaps the
 * visible month up to `todayYmd` (a future month has no visible days).
 */
export function activeHabits(habits: DashHabit[], monthKey: string, todayYmd: string): DashHabit[] {
  const days = monthDays(monthKey);
  if (days.length === 0) return [];
  const monthStart = days[0];
  const monthEnd = days[days.length - 1];
  const visibleEnd = monthEnd < todayYmd ? monthEnd : todayYmd;
  if (visibleEnd < monthStart) return [];
  return habits.filter((habit) => {
    if (habit.isArchived) return false;
    if (habit.startDate && habit.startDate > visibleEnd) return false;
    if (habit.endDate && habit.endDate < monthStart) return false;
    return true;
  });
}

/** Month compliance over active habits: done expected cells / expected cells; `0` when none expected. */
export function monthlyCompliance(
  habits: DashHabit[],
  logs: DashLog[],
  monthKey: string,
  todayYmd: string,
): MonthlyCompliance {
  const donePairs = donePairsOf(logs);
  let expected = 0;
  let done = 0;
  for (const habit of activeHabits(habits, monthKey, todayYmd)) {
    for (const date of expectedDates(habit, monthKey, todayYmd)) {
      expected += 1;
      if (donePairs.has(pairKey(habit.id, date))) done += 1;
    }
  }
  return { pct: pctOf(done, expected), done, expected };
}

/** Percentage-point difference vs the previous month; `null` when the previous month has no data. */
export function complianceDelta(current: MonthlyCompliance, previous: MonthlyCompliance): number | null {
  if (previous.expected <= 0) return null;
  return round1(current.pct - previous.pct);
}

/**
 * Longest done-run over expected days across every habit (full history — callers
 * pass up to 12 months of logs). Both habits of a tie come back in `habitNames`.
 */
export function longestStreak(habits: DashHabit[], logs: DashLog[]): LongestStreak {
  const doneByHabit = new Map<string, Set<string>>();
  const lastLogByHabit = new Map<string, string>();
  for (const entry of logs) {
    let doneDates = doneByHabit.get(entry.habitId);
    if (!doneDates) {
      doneDates = new Set<string>();
      doneByHabit.set(entry.habitId, doneDates);
    }
    if (isDone(entry.status)) doneDates.add(entry.date);
    const last = lastLogByHabit.get(entry.habitId);
    if (!last || entry.date > last) lastLogByHabit.set(entry.habitId, entry.date);
  }
  const perHabit: Array<{ name: string; days: number }> = [];
  for (const habit of habits) {
    const doneDates = doneByHabit.get(habit.id);
    const lastLog = lastLogByHabit.get(habit.id);
    if (!doneDates || !lastLog) continue;
    let end = lastLog;
    if (habit.endDate && habit.endDate < end) end = habit.endDate;
    const startMs = toMs(habit.startDate);
    const endMs = toMs(end);
    if (!Number.isFinite(startMs) || startMs > endMs) continue;
    let run = 0;
    let best = 0;
    for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
      const date = ymd(ms);
      if (!maskMatches(habit, date)) continue;
      if (doneDates.has(date)) {
        run += 1;
        if (run > best) best = run;
      } else {
        run = 0;
      }
    }
    perHabit.push({ name: habit.name, days: best });
  }
  let bestDays = 0;
  for (const entry of perHabit) if (entry.days > bestDays) bestDays = entry.days;
  if (bestDays === 0) return { days: 0, habitNames: [] };
  return { days: bestDays, habitNames: perHabit.filter((entry) => entry.days === bestDays).map((entry) => entry.name) };
}

/** Distinct non-empty categories across the given habits. */
export function categoriesCovered(habits: DashHabit[]): number {
  const categories = new Set<string>();
  for (const habit of habits) {
    const category = habit.category?.trim();
    if (category) categories.add(category);
  }
  return categories.size;
}

/** Expected vs done for `todayYmd` over non-archived habits (the ones "due today"). */
export function todayCompletion(habits: DashHabit[], logs: DashLog[], todayYmd: string): TodayCompletion {
  const doneToday = new Set<string>();
  for (const entry of logs) {
    if (entry.date === todayYmd && isDone(entry.status)) doneToday.add(entry.habitId);
  }
  let total = 0;
  let done = 0;
  for (const habit of habits) {
    if (habit.isArchived) continue;
    if (!isExpected(habit, todayYmd, todayYmd)) continue;
    total += 1;
    if (doneToday.has(habit.id)) done += 1;
  }
  return { done, total };
}

/**
 * Per-weekday compliance over the visible month, Monday-first (index 0..6):
 * `values[i]` = done/expected × 100 for that weekday, `avg` their mean
 * (`0` when nothing was expected) and `best` the highest value.
 */
export function weekdayConsistency(
  habits: DashHabit[],
  logs: DashLog[],
  monthKey: string,
  todayYmd: string,
): WeekdayConsistency {
  const donePairs = donePairsOf(logs);
  const done = [0, 0, 0, 0, 0, 0, 0];
  const expected = [0, 0, 0, 0, 0, 0, 0];
  for (const habit of activeHabits(habits, monthKey, todayYmd)) {
    for (const date of expectedDates(habit, monthKey, todayYmd)) {
      const index = (dow(toMs(date)) + 6) % 7;
      expected[index] += 1;
      if (donePairs.has(pairKey(habit.id, date))) done[index] += 1;
    }
  }
  const values = done.map((count, index) => pctOf(count, expected[index]));
  const totalExpected = expected.reduce((sum, count) => sum + count, 0);
  const avg = totalExpected === 0 ? 0 : round1(values.reduce((sum, value) => sum + value, 0) / 7);
  let bestIndex = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[bestIndex]) bestIndex = index;
  }
  return { values, avg, best: { index: bestIndex, pct: values[bestIndex] } };
}

/** XP earned in `monthKey`: +10 per done cell. */
export function xpForLogs(logs: DashLog[], monthKey: string): number {
  if (monthDays(monthKey).length === 0) return 0;
  let done = 0;
  for (const entry of logs) {
    if (isDone(entry.status) && entry.date.slice(0, 7) === monthKey) done += 1;
  }
  return done * XP_PER_DONE;
}

/** Historical XP over every done log: +10 each. */
export function totalXp(logs: DashLog[]): number {
  let done = 0;
  for (const entry of logs) if (isDone(entry.status)) done += 1;
  return done * XP_PER_DONE;
}

/** Level from historical XP: `1 + floor(xp / 500)`. */
export function levelForXp(xp: number): number {
  return 1 + Math.floor(xp / XP_PER_LEVEL);
}

/**
 * Current streak: consecutive done expected days ending at the latest done day.
 * Trailing expected days without any log are tolerated (today may not be
 * registered yet); an explicitly non-done expected day breaks the streak.
 */
function currentStreakDays(habit: DashHabit, logs: DashLog[], todayYmd: string): number {
  const startMs = toMs(habit.startDate);
  if (!Number.isFinite(startMs)) return 0;
  const doneDates = new Set<string>();
  const loggedDates = new Set<string>();
  for (const entry of logs) {
    if (entry.habitId !== habit.id) continue;
    loggedDates.add(entry.date);
    if (isDone(entry.status)) doneDates.add(entry.date);
  }
  let ms = toMs(todayYmd);
  while (ms >= startMs) {
    const date = ymd(ms);
    if (isExpected(habit, date, todayYmd)) {
      if (doneDates.has(date)) break;
      if (loggedDates.has(date)) return 0;
    }
    ms -= DAY_MS;
  }
  let days = 0;
  while (ms >= startMs) {
    const date = ymd(ms);
    if (isExpected(habit, date, todayYmd)) {
      if (!doneDates.has(date)) break;
      days += 1;
    }
    ms -= DAY_MS;
  }
  return days;
}

/**
 * Unlocked milestone: a category at 100% over the last 14 days, else the best
 * current streak of at least 7 days, else `null`.
 */
export function findMilestone(habits: DashHabit[], logs: DashLog[], todayYmd: string): Milestone | null {
  const active = habits.filter((habit) => !habit.isArchived);
  const donePairs = donePairsOf(logs);
  const windowStartMs = toMs(todayYmd) - 13 * DAY_MS;
  const todayMs = toMs(todayYmd);
  const byCategory = new Map<string, { done: number; expected: number }>();
  for (const habit of active) {
    const category = habit.category?.trim();
    if (!category) continue;
    let bucket = byCategory.get(category);
    if (!bucket) {
      bucket = { done: 0, expected: 0 };
      byCategory.set(category, bucket);
    }
    for (let ms = windowStartMs; ms <= todayMs; ms += DAY_MS) {
      const date = ymd(ms);
      if (!isExpected(habit, date, todayYmd)) continue;
      bucket.expected += 1;
      if (donePairs.has(pairKey(habit.id, date))) bucket.done += 1;
    }
  }
  let bestCategory: string | null = null;
  let bestExpected = 0;
  for (const [category, bucket] of byCategory) {
    if (bucket.expected > 0 && bucket.done === bucket.expected && bucket.expected > bestExpected) {
      bestCategory = category;
      bestExpected = bucket.expected;
    }
  }
  if (bestCategory) return { kind: "category", category: bestCategory };

  let bestHabit: string | null = null;
  let bestDays = 0;
  for (const habit of active) {
    const days = currentStreakDays(habit, logs, todayYmd);
    if (days > bestDays) {
      bestDays = days;
      bestHabit = habit.name;
    }
  }
  if (bestHabit && bestDays >= 7) return { kind: "streak", habitName: bestHabit, days: bestDays };
  return null;
}

/**
 * Reflection insight: for each habit, compares the average compliance of the
 * other habits on days it was done vs days it was not; the strongest positive
 * gap wins. Needs at least 14 days of logged history, else `null`. Returns
 * `{ habitName, points }` so the caller formats the sentence.
 */
export function reflectionLine(habits: DashHabit[], logs: DashLog[], todayYmd: string): ReflectionInsight | null {
  const loggedDates = new Set<string>();
  const donePairs = new Set<string>();
  let earliest: string | null = null;
  for (const entry of logs) {
    loggedDates.add(entry.date);
    if (isDone(entry.status)) donePairs.add(pairKey(entry.habitId, entry.date));
    if (!earliest || entry.date < earliest) earliest = entry.date;
  }
  if (loggedDates.size < 14 || !earliest || earliest > todayYmd) return null;
  const active = habits.filter((habit) => !habit.isArchived);
  if (active.length < 2) return null;
  const todayMs = toMs(todayYmd);
  let insight: ReflectionInsight | null = null;
  for (const subject of active) {
    const startMs = Math.max(toMs(earliest), toMs(subject.startDate));
    if (!Number.isFinite(startMs)) continue;
    let onSum = 0;
    let onCount = 0;
    let offSum = 0;
    let offCount = 0;
    for (let ms = startMs; ms <= todayMs; ms += DAY_MS) {
      const date = ymd(ms);
      if (!isExpected(subject, date, todayYmd)) continue;
      let othersDone = 0;
      let othersExpected = 0;
      for (const other of active) {
        if (other.id === subject.id) continue;
        if (!isExpected(other, date, todayYmd)) continue;
        othersExpected += 1;
        if (donePairs.has(pairKey(other.id, date))) othersDone += 1;
      }
      if (othersExpected === 0) continue;
      const ratio = (othersDone / othersExpected) * 100;
      if (donePairs.has(pairKey(subject.id, date))) {
        onSum += ratio;
        onCount += 1;
      } else {
        offSum += ratio;
        offCount += 1;
      }
    }
    if (onCount === 0 || offCount === 0) continue;
    const points = round1(onSum / onCount - offSum / offCount);
    if (points > 0 && (!insight || points > insight.points)) insight = { habitName: subject.name, points };
  }
  return insight;
}
