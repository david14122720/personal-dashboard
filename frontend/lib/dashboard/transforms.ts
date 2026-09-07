/**
 * Dashboard transform boundary.
 *
 * Wire money arrives as decimal STRINGS (e.g. "1000.00"). These pure
 * helpers are the only place (besides `lib/api/money.ts`) that coerce
 * them to numbers for Recharts and metric rendering. UI components
 * receive numbers only — they never parse strings themselves.
 */

import { toNumber } from "@/lib/api/money";

export interface MonthlyFlowWire {
  month: string;
  income: string | number;
  expense: string | number;
}

export interface FlowPoint {
  month: string;
  income: number;
  expense: number;
  balance: number;
}

/** Coerce an aggregate monthly-flow response to chart-ready points. */
export function toFlowPoints(rows: MonthlyFlowWire[] | null | undefined): FlowPoint[] {
  if (!rows) return [];
  return rows.map((row) => {
    const income = toNumber(row.income);
    const expense = toNumber(row.expense);
    return { month: row.month, income, expense, balance: income - expense };
  });
}

export interface CategoryWire {
  category_id: string;
  name: string;
  total: string | number;
}

export interface DonutSlice {
  id: string;
  name: string;
  value: number;
}

/** Coerce a by-category aggregate response to donut slices. */
export function toDonutSlices(rows: CategoryWire[] | null | undefined): DonutSlice[] {
  if (!rows) return [];
  return rows.map((row) => ({
    id: row.category_id,
    name: row.name,
    value: toNumber(row.total),
  }));
}

/**
 * Backend LED enums, 1:1 with the API:
 * - account `alert_level` ∈ { ok, warn, high }
 * - budget `status` ∈ { ok, warn, over }
 */
export type LedStatus = "ok" | "warn" | "over" | "high";

/** Map a backend status enum to its telemetry LED dot class (token colors). */
export function ledDotClass(status: string | null | undefined): string {
  switch (status) {
    case "ok":
      return "bg-flow";
    case "warn":
      return "bg-signal";
    case "over":
    case "high":
      return "bg-alert";
    default:
      return "bg-instrument/30";
  }
}

/** Worst-of rollup for budget LEDs: over > warn > ok. Unknowns ignored. */
export function worstBudgetStatus(statuses: Array<string | null | undefined>): LedStatus | "none" {
  let worst: LedStatus | "none" = "none";
  for (const status of statuses) {
    if (status === "over") return "over";
    if (status === "warn") worst = "warn";
    else if (status === "ok" && worst === "none") worst = "ok";
  }
  return worst;
}

/** Worst-of rollup for account alert LEDs: high > warn > ok. */
export function worstAlertLevel(levels: Array<string | null | undefined>): LedStatus | "none" {
  let worst: LedStatus | "none" = "none";
  for (const level of levels) {
    if (level === "high") return "high";
    if (level === "warn") worst = "warn";
    else if (level === "ok" && worst === "none") worst = "ok";
  }
  return worst;
}

/** Savings rate as a fraction, or null when there is no income to divide by. */
export function savingsRate(income: number, expense: number): number | null {
  if (!Number.isFinite(income) || income <= 0) return null;
  return (income - expense) / income;
}

/** Longest current streak across today's habits. */
export function longestStreak(habits: Array<{ current_streak: number }> | null | undefined): number {
  if (!habits || habits.length === 0) return 0;
  let best = 0;
  for (const habit of habits) {
    if (Number.isFinite(habit.current_streak) && habit.current_streak > best) {
      best = habit.current_streak;
    }
  }
  return best;
}

/** Balance for a calendar month key (`YYYY-MM`), 0 when the month is absent. */
export function monthBalance(points: FlowPoint[], monthKey: string): number {
  const point = points.find((p) => p.month === monthKey);
  return point ? point.balance : 0;
}

/** Current month key (`YYYY-MM`) in local time. */
export function currentMonthKey(now: Date = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

/** First day (`YYYY-MM-DD`) N months before the given date, for range params. */
export function monthsAgoStart(now: Date = new Date(), monthsBack: number = 11): string {
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const month = `${start.getMonth() + 1}`.padStart(2, "0");
  const day = `${start.getDate()}`.padStart(2, "0");
  return `${start.getFullYear()}-${month}-${day}`;
}

/** ISO day (`YYYY-MM-DD`) in local time, for range params. */
export function toISODate(date: Date = new Date()): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
