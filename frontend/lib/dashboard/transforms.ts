/**
 * Dashboard transform boundary.
 *
 * Wire money arrives as decimal STRINGS (e.g. "1000.00"). These pure
 * helpers are the only place (besides `lib/api/money.ts`) that coerce
 * them to numbers for Recharts and metric rendering. UI components
 * receive numbers only — they never parse strings themselves.
 */

import { toNumber } from "@/lib/api/money";

/**
 * Backend LED enum, 1:1 with the API:
 * - account `alert_level` ∈ { ok, warn, high }
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

/* -- S3b: finance snapshot transforms (surviving sources only) -- */

export interface SubscriptionCostLike {
  price?: string | number | null;
  frequency?: string | null;
  is_active?: boolean | null;
}

/**
 * Monthly-equivalent cost of active subscriptions. Frequency catalog mirrors
 * backend SUBSCRIPTION_FREQUENCIES: daily×30, weekly×52/12, biweekly×26/12,
 * monthly×1, quarterly÷3, semiannual÷6, annual÷12. Inactive subscriptions are
 * excluded; unknown frequencies are excluded (never a silent 1× assumption).
 * Empty/undefined → 0.
 */
export function toMonthlyCost(subs: SubscriptionCostLike[] | null | undefined): number {
  if (!subs) return 0;
  let total = 0;
  for (const sub of subs) {
    if (sub.is_active !== true) continue;
    const factor =
      sub.frequency === "daily" ? 30
      : sub.frequency === "weekly" ? 52 / 12
      : sub.frequency === "biweekly" ? 26 / 12
      : sub.frequency === "monthly" ? 1
      : sub.frequency === "quarterly" ? 1 / 3
      : sub.frequency === "semiannual" ? 1 / 6
      : sub.frequency === "annual" ? 1 / 12
      : null;
    if (factor === null) continue;
    total += toNumber(sub.price) * factor;
  }
  return total;
}

export interface FinanceSnapshotInput {
  netWorth: number;
  monthlySubsCost: number;
}

export interface FinanceSnapshot {
  netWorth: number;
  monthlySubsCost: number;
}

/** Reports finance snapshot: two current values, no period window. */
export function toFinanceSnapshot(input: FinanceSnapshotInput): FinanceSnapshot {
  return {
    netWorth: input.netWorth,
    monthlySubsCost: input.monthlySubsCost,
  };
}

export interface FinanceScoreInput {
  /** Net worth, or null/undefined when no net-worth data is available. */
  netWorth: number | null | undefined;
}

/**
 * Progress finance score from the only surviving input: 100 when net worth
 * is greater than zero, 0 when it is zero or negative, and null (neutral
 * empty visual, never a fabricated score) when no net-worth data exists.
 * Presentational only — never a verdict.
 */
export function toFinanceScore(input: FinanceScoreInput): number | null {
  if (input.netWorth === null || input.netWorth === undefined) return null;
  if (!Number.isFinite(input.netWorth)) return null;
  return input.netWorth > 0 ? 100 : 0;
}

/* -- p8-home-pagos PR1: upcoming 7d + overdue (S3/S4) -- */

/** Inclusive natural-day windows (local `es-CO`): bell/payments 7d, events widget 14d. */
export const UPCOMING_PAYMENTS_WINDOW_DAYS = 7;
export const UPCOMING_EVENTS_WINDOW_DAYS = 14;

export interface UpcomingSubLike {
  id: string;
  name?: string | null;
  price?: string | number | null;
  is_active?: boolean | null;
  next_billing_on?: string | null;
}

export interface UpcomingEventLike {
  id: string;
  title?: string | null;
  kind?: string | null;
  starts_at?: string | null;
}

export interface OverdueTaskLike {
  id: string;
  title?: string | null;
  status?: string | null;
  due_date?: string | null;
}

export interface UpcomingPaymentItem {
  id: string;
  kind: "event" | "subscription";
  title: string;
  due: string;
  amount?: number;
  source: string;
}

export interface OverdueItem {
  id: string;
  kind: "task" | "event";
  title: string;
  due: string;
  amount?: number;
  source: string;
}

function startOfDayLocal(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfWindowLocal(start: Date, days: number): Date {
  const end = new Date(start);
  end.setDate(start.getDate() + days);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** Parse `YYYY-MM-DD` as local midnight, otherwise RFC3339/ISO instant. Null when invalid. */
function parseDueDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dayMatch) {
    const y = Number(dayMatch[1]);
    const m = Number(dayMatch[2]);
    const d = Number(dayMatch[3]);
    if (!Number.isFinite(y) || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const parsed = new Date(y, m - 1, d, 0, 0, 0, 0);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function upcomingRank(kind: UpcomingPaymentItem["kind"] | OverdueItem["kind"]): number {
  if (kind === "event") return 0;
  if (kind === "subscription") return 1;
  return 2;
}

/**
 * Union 7d `[hoy00:00, hoy+7 23:59]` local `es-CO`: subs + `payment_due`
 * events, orden asc + desempate events>subs.
 */
export function toUpcomingPayments(
  subs: UpcomingSubLike[] | null | undefined,
  events: UpcomingEventLike[] | null | undefined,
  now: Date = new Date(),
): UpcomingPaymentItem[] {
  const start = startOfDayLocal(now);
  const end = endOfWindowLocal(start, UPCOMING_PAYMENTS_WINDOW_DAYS);
  const out: Array<UpcomingPaymentItem & { dueTime: number }> = [];

  for (const sub of subs ?? []) {
    if (sub.is_active !== true) continue;
    const at = parseDueDate(sub.next_billing_on);
    if (!at) continue;
    if (at < start || at > end) continue;
    out.push({
      id: sub.id,
      kind: "subscription",
      title: sub.name?.trim() || sub.id,
      due: (sub.next_billing_on as string).trim(),
      amount: sub.price === undefined || sub.price === null ? undefined : toNumber(sub.price),
      source: "subscription",
      dueTime: at.getTime(),
    });
  }

  for (const event of events ?? []) {
    if (event.kind !== "payment_due") continue;
    const at = parseDueDate(event.starts_at);
    if (!at) continue;
    if (at < start || at > end) continue;
    out.push({
      id: event.id,
      kind: "event",
      title: event.title?.trim() || event.id,
      due: (event.starts_at as string).trim(),
      source: "event",
      dueTime: at.getTime(),
    });
  }

  out.sort((a, b) => (a.dueTime === b.dueTime ? upcomingRank(a.kind) - upcomingRank(b.kind) : a.dueTime - b.dueTime));
  return out.map(({ dueTime: _ignored, ...rest }) => rest);
}

/**
 * Vencidas: tasks `due_date < hoy` no completadas + events `payment_due`
 * con `starts_at` en día anterior a hoy (pasado estricto por día: hoy queda
 * solo en Próximos, nunca en ambas). Orden asc, desempate events>tasks.
 */
export function toOverdueItems(
  tasks: OverdueTaskLike[] | null | undefined,
  events: UpcomingEventLike[] | null | undefined,
  now: Date = new Date(),
): OverdueItem[] {
  const start = startOfDayLocal(now);
  const out: Array<OverdueItem & { dueTime: number }> = [];

  for (const task of tasks ?? []) {
    if (task.status === "completed" || task.status === "cancelled") continue;
    const at = parseDueDate(task.due_date);
    if (!at) continue;
    if (at >= start) continue;
    out.push({
      id: task.id,
      kind: "task",
      title: task.title?.trim() || task.id,
      due: (task.due_date as string).trim(),
      source: "task",
      dueTime: at.getTime(),
    });
  }

  for (const event of events ?? []) {
    if (event.kind !== "payment_due") continue;
    const at = parseDueDate(event.starts_at);
    if (!at) continue;
    // Pasado estricto por día: hoy (aunque la hora ya pasó) queda en Próximos, no en Vencidas.
    if (at >= start) continue;
    out.push({
      id: event.id,
      kind: "event",
      title: event.title?.trim() || event.id,
      due: (event.starts_at as string).trim(),
      source: "event",
      dueTime: at.getTime(),
    });
  }

  out.sort((a, b) => (a.dueTime === b.dueTime ? upcomingRank(a.kind) - upcomingRank(b.kind) : a.dueTime - b.dueTime));
  return out.map(({ dueTime: _ignored, ...rest }) => rest);
}

/* -- p8-home-pagos PR1: pending lists + goals + notifications -- */

export interface ActiveSub {
  id: string;
  name: string;
  price: number;
  next_billing_on: string | null;
  is_active: boolean;
}

export interface PendingTask {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
}

export interface UpcomingEventItem {
  id: string;
  title: string;
  kind: string;
  starts_at: string;
}

export interface GoalLike {
  id: string;
  name?: string | null;
  progress?: number | null;
  status?: string | null;
}

export interface GoalSegment {
  id: string;
  name: string;
  pct: number;
}

export interface GoalProgress {
  goals: GoalSegment[];
}

export interface NotificationItem {
  id: string;
  kind: "task" | "event" | "subscription";
  title: string;
  due: string;
  amount?: number;
  source: string;
}

function compareDayAscNullsLast(a: string | null, b: string | null): number {
  const ta = parseDueDate(a);
  const tb = parseDueDate(b);
  if (!ta && !tb) return 0;
  if (!ta) return 1;
  if (!tb) return -1;
  return ta.getTime() - tb.getTime();
}

/** Subs `is_active` con `price` numérico, ordenadas por `next_billing_on` asc (nulas al final). */
export function toActiveSubs(subs: UpcomingSubLike[] | null | undefined): ActiveSub[] {
  const rows = (subs ?? []).filter((s) => s.is_active === true);
  const mapped: ActiveSub[] = rows.map((s) => ({
    id: s.id,
    name: s.name?.trim() || s.id,
    price: toNumber(s.price),
    next_billing_on: s.next_billing_on ?? null,
    is_active: true,
  }));
  mapped.sort((a, b) => compareDayAscNullsLast(a.next_billing_on, b.next_billing_on));
  return mapped;
}

/** Tareas no completadas/canceladas, ordenadas por `due_date` asc (nulas al final). */
export function toPendingTasks(tasks: OverdueTaskLike[] | null | undefined): PendingTask[] {
  const rows = (tasks ?? []).filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const mapped: PendingTask[] = rows.map((t) => ({
    id: t.id,
    title: t.title?.trim() || t.id,
    status: t.status ?? "pending",
    due_date: t.due_date ?? null,
  }));
  mapped.sort((a, b) => compareDayAscNullsLast(a.due_date, b.due_date));
  return mapped;
}

/**
 * Próximos eventos 14d `[hoy00:00, hoy+14 23:59]` solo visual (no contamina la campanita 7d).
 * Incluye todos los `kind`; orden asc por `starts_at`.
 */
export function toUpcomingEvents(
  events: UpcomingEventLike[] | null | undefined,
  now: Date = new Date(),
  windowDays = UPCOMING_EVENTS_WINDOW_DAYS,
): UpcomingEventItem[] {
  const start = startOfDayLocal(now);
  const end = endOfWindowLocal(start, windowDays);
  const out: Array<UpcomingEventItem & { dueTime: number }> = [];
  for (const event of events ?? []) {
    const at = parseDueDate(event.starts_at);
    if (!at) continue;
    if (at < start || at > end) continue;
    out.push({
      id: event.id,
      title: event.title?.trim() || event.id,
      kind: event.kind ?? "event",
      starts_at: (event.starts_at as string).trim(),
      dueTime: at.getTime(),
    });
  }
  out.sort((a, b) => a.dueTime - b.dueTime);
  return out.map(({ dueTime: _ignored, ...rest }) => rest);
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

/** Un segmento en el widget: Metas (`progress` de `GET /goals`, solo lectura). */
export function toGoalProgress(
  goals: GoalLike[] | null | undefined,
): GoalProgress {
  const goalSegments: GoalSegment[] = (goals ?? []).map((g) => ({
    id: g.id,
    name: g.name?.trim() || g.id,
    pct: clampPct(typeof g.progress === "number" ? g.progress : 0),
  }));
  return { goals: goalSegments };
}

/** Unión vencidas + próximos para la campanita (mismo orden de entrada). */
export function toNotificationItems(
  overdue: NotificationItem[] | null | undefined,
  upcoming: NotificationItem[] | null | undefined,
): NotificationItem[] {
  return [...(overdue ?? []), ...(upcoming ?? [])];
}

/** Badge = visibles − muteados − fuentes ocultas. `visibleSources` nulo = todo visible. */
export function toNotificationCount(
  items: NotificationItem[] | null | undefined,
  muted: Record<string, boolean | true> | null | undefined,
  visibleSources: Set<string> | string[] | Record<string, boolean> | null | undefined,
): number {
  const list = items ?? [];
  const isVisible = (source: string): boolean => {
    if (!visibleSources) return true;
    if (visibleSources instanceof Set) return visibleSources.has(source);
    if (Array.isArray(visibleSources)) return visibleSources.includes(source);
    return Boolean(visibleSources[source]);
  };
  let count = 0;
  for (const item of list) {
    if (muted?.[item.id]) continue;
    if (!isVisible(item.source)) continue;
    count += 1;
  }
  return count;
}
