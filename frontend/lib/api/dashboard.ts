/**
 * Dashboard read layer: typed fetchers over `apiGet` plus SWR hooks.
 *
 * Money stays a decimal string on the wire; coercion happens in
 * `lib/dashboard/transforms.ts` at the container boundary — never here
 * and never inside UI components.
 */

import useSWR, { useSWRConfig, type SWRConfiguration } from "swr";
import { apiGet, apiPatch } from "@/lib/api/client";

export type { NotificationItem } from "@/lib/dashboard/transforms";

export interface NetWorthEntryWire {
  currency: string;
  assets: string | number;
  debts: string | number;
  net_worth: string | number;
}

export interface NetWorthWire {
  per_currency: NetWorthEntryWire[];
}

export interface HabitTodayWire {
  habit_id: string;
  name: string;
  habit_frequency: string;
  days_of_week: number[];
  current_streak: number;
  today_status: string;
}

export interface AccountWire {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: string | number;
  alert_level?: string | null;
}

export type DashboardWidgetType = "metric" | "chart" | "list" | "ledger" | "heatmap";
export type DashboardWidgetSize = "sm" | "md" | "lg";

export interface DashboardWidgetPref {
  id: string;
  type: DashboardWidgetType;
  order: number;
  size: DashboardWidgetSize;
}

export interface DashboardLayout {
  widgets: DashboardWidgetPref[];
}

/** Default 5-widget layout (first run / empty / invalid → all visible). Order per D1/S-H. */
export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = {
  widgets: [
    { id: "upcoming-payments", type: "list", order: 20, size: "lg" },
    { id: "active-subs", type: "list", order: 22, size: "md" },
    { id: "pending-tasks", type: "list", order: 23, size: "md" },
    { id: "upcoming-events", type: "list", order: 24, size: "md" },
    { id: "goal-progress", type: "chart", order: 30, size: "md" },
  ],
};

export interface PreferencesWire {
  currency_code: string;
  locale: string;
  timezone?: string | null;
  dashboard_layout?: DashboardLayout | null;
}

export interface MeWire {
  preferences: PreferencesWire;
}

/** Exact envelope for `PATCH /me/preferences` (`deny_unknown_fields` → 422 otherwise). */
export interface PatchPreferencesBody {
  dashboard_layout: DashboardLayout;
}

const config: SWRConfiguration = { revalidateOnFocus: false };

export function useNetWorth() {
  return useSWR<NetWorthWire>("dashboard/net-worth", () => apiGet<NetWorthWire>("/net-worth"), config);
}

/** SWR key for the dashboard-home habits widget; toggles revalidate it. */
export const DASHBOARD_HABITS_TODAY_KEY = "dashboard/habits-today";

export function useHabitsToday() {
  return useSWR<HabitTodayWire[]>(
    DASHBOARD_HABITS_TODAY_KEY,
    () => apiGet<HabitTodayWire[]>("/habits/today"),
    config,
  );
}
// NOTE: range history (`habits-history`) lives in lib/api/productivity.ts
// (`useHabitsHistory`); do not duplicate the hook here.

export function useAccounts() {
  return useSWR<AccountWire[]>(
    "dashboard/accounts",
    () => apiGet<AccountWire[]>("/accounts"),
    config,
  );
}

export function usePreferences() {
  return useSWR<MeWire>("dashboard/me", () => apiGet<MeWire>("/me"), config);
}

/* -- p8-home-pagos PR2: wires + hooks SWR (montos string|number, coercion solo en transforms) -- */

export interface SubscriptionWire { id: string; name: string; price?: string | number | null; is_active?: boolean | null; next_billing_on?: string | null; frequency?: string | null; }
export interface TaskWire { id: string; title: string; status?: string | null; priority?: string | null; due_date?: string | null; goal_id?: string | null; }
export interface EventWire { id: string; title: string; kind: string; starts_at: string; ends_at?: string | null; }
export interface GoalWire { id: string; name?: string | null; progress?: number | null; status?: string | null; }

export const subscriptionsKey = (v: boolean): string | null => (v ? "dashboard/subscriptions" : null);
export const tasksKey = (view: string | null, v: boolean): string | null => (!v ? null : view ? `dashboard/tasks?view=${view}` : "dashboard/tasks");
export function eventsKey(from: string | null, to: string | null, v: boolean): string | null {
  if (!v) return null;
  const p = new URLSearchParams();
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  const qs = p.toString();
  return qs ? `dashboard/events?${qs}` : "dashboard/events";
}
export const goalsKey = (v: boolean): string | null => (v ? "dashboard/goals" : null);

export function resolveDashboardLayout(me: MeWire | null | undefined): DashboardLayout {
  const w = me?.preferences?.dashboard_layout?.widgets;
  if (!Array.isArray(w) || w.length === 0) return DEFAULT_DASHBOARD_LAYOUT;
  return { widgets: w };
}
export const isWidgetVisible = (l: DashboardLayout | null | undefined, id: string): boolean =>
  !l ? true : l.widgets.some((w) => w.id === id);
export function buildNextLayout(cur: DashboardLayout, id: string, visible: boolean): DashboardLayout {
  if (visible && !isWidgetVisible(cur, id)) {
    const def = DEFAULT_DASHBOARD_LAYOUT.widgets.find((w) => w.id === id);
    if (!def) return cur;
    return { widgets: [...cur.widgets, def].sort((a, b) => a.order - b.order) };
  }
  if (!visible) return { widgets: cur.widgets.filter((w) => w.id !== id) };
  return cur;
}

export function useSubscriptions(v = true) {
  const key = subscriptionsKey(v);
  return useSWR<SubscriptionWire[]>(key, () => apiGet<SubscriptionWire[]>("/subscriptions"), config);
}
export function useTasks(view: string | null, v = true) {
  const key = tasksKey(view, v);
  return useSWR<TaskWire[]>(key, () => apiGet<TaskWire[]>(view ? `/tasks?view=${view}` : "/tasks"), config);
}
export function useEvents(from: string | null, to: string | null, v = true) {
  const key = eventsKey(from, to, v);
  const p = new URLSearchParams();
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  const qs = p.toString();
  return useSWR<EventWire[]>(key, () => apiGet<EventWire[]>(qs ? `/events?${qs}` : "/events"), config);
}
export function useGoals(v = true) {
  const key = goalsKey(v);
  return useSWR<GoalWire[]>(key, () => apiGet<GoalWire[]>("/goals"), config);
}
/** Optimistic `PATCH /me/preferences { dashboard_layout }` with rollback on 422. */
export function useUpdateLayout() {
  const { mutate } = useSWRConfig();
  return async (next: DashboardLayout): Promise<void> => {
    const key = "dashboard/me";
    await mutate(key,
      async (cur: MeWire | undefined) => {
        const patched = await apiPatch<PreferencesWire>("/me/preferences", { dashboard_layout: next } satisfies PatchPreferencesBody);
        return { preferences: patched } as MeWire;
      },
      {
        optimisticData: (cur: MeWire | undefined) => ({ preferences: { ...(cur?.preferences ?? { currency_code: "COP", locale: "es-CO" }), dashboard_layout: next } } as MeWire),
        rollbackOnError: true,
        revalidate: true,
      });
  };
}
