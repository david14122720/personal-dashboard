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

export interface PreferencesWire {
  currency_code: string;
  locale: string;
  timezone?: string;
}

export interface MeWire {
  preferences: PreferencesWire;
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
