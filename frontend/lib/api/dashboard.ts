/**
 * Dashboard read layer: typed fetchers over `apiGet` plus SWR hooks.
 *
 * Money stays a decimal string on the wire; coercion happens in
 * `lib/dashboard/transforms.ts` at the container boundary — never here
 * and never inside UI components.
 */

import useSWR, { type SWRConfiguration } from "swr";
import { apiGet } from "@/lib/api/client";

export interface NetWorthEntryWire {
  currency: string;
  assets: string | number;
  debts: string | number;
  net_worth: string | number;
}

export interface NetWorthWire {
  per_currency: NetWorthEntryWire[];
}

export interface MonthlyFlowRowWire {
  month: string;
  income: string | number;
  expense: string | number;
}

export interface CategoryTotalWire {
  category_id: string;
  name: string;
  total: string | number;
}

export interface BudgetWire {
  id: string;
  category_id: string;
  amount: string | number;
  currency: string;
  period_start: string;
  period_end: string;
  spent: string | number;
  remaining: string | number;
  pct: number;
  status: string;
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

/** Default 9-widget layout (first run / empty / invalid → all visible). Order per design §5.1. */
export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = {
  widgets: [
    { id: "month-income", type: "metric", order: 10, size: "sm" },
    { id: "month-expense", type: "metric", order: 11, size: "sm" },
    { id: "month-savings", type: "metric", order: 12, size: "sm" },
    { id: "upcoming-payments", type: "list", order: 20, size: "lg" },
    { id: "pending-debts", type: "list", order: 21, size: "md" },
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

export function useMonthlyFlow(from: string | null, to: string | null) {
  const key = from && to ? `dashboard/monthly-flow?from=${from}&to=${to}` : null;
  return useSWR<MonthlyFlowRowWire[]>(
    key,
    () => apiGet<MonthlyFlowRowWire[]>(`/transactions/stats/monthly-flow?from=${from}&to=${to}`),
    config,
  );
}

export function useSpendByCategory(from: string | null, to: string | null) {
  const key = from && to ? `dashboard/by-category?from=${from}&to=${to}` : null;
  return useSWR<CategoryTotalWire[]>(
    key,
    () =>
      apiGet<CategoryTotalWire[]>(
        `/transactions/stats/by-category?from=${from}&to=${to}&type=expense`,
      ),
    config,
  );
}

export function useBudgets() {
  return useSWR<BudgetWire[]>("dashboard/budgets", () => apiGet<BudgetWire[]>("/budgets"), config);
}

export function useHabitsToday() {
  return useSWR<HabitTodayWire[]>(
    "dashboard/habits-today",
    () => apiGet<HabitTodayWire[]>("/habits/today"),
    config,
  );
}

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
