/**
 * Finance read layer: typed fetchers over `apiGet` plus SWR hooks for the
 * finance screens (`/dashboard/finance`).
 *
 * Money stays a decimal string on the wire; coercion happens at the
 * container boundary (`lib/finance/finance.ts`) — never here and never
 * inside UI components. Cursor values are opaque strings: this module
 * forwards them verbatim and never decodes them.
 */

import useSWR, { type SWRConfiguration } from "swr";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api/client";

const financeConfig: SWRConfiguration = { revalidateOnFocus: false };

export interface SubscriptionWire {
  id: string;
  name: string;
  price: string | number;
  currency: string;
  frequency: string;
  next_billing_on: string | null;
  is_active: boolean;
  payment_method?: string | null;
  category_id?: string | null;
}

export function useSubscriptions() {
  return useSWR<SubscriptionWire[]>(
    "finance/subscriptions",
    () => apiGet<SubscriptionWire[]>("/subscriptions"),
    financeConfig,
  );
}

export interface DebtWire {
  id: string;
  name: string;
  creditor: string;
  original_amount: string | number;
  pending_amount: string | number;
  currency: string;
  status: string;
  due_date: string | null;
  installment?: string | number | null;
  start_date?: string | null;
}

export function useDebts() {
  return useSWR<DebtWire[]>(
    "finance/debts",
    () => apiGet<DebtWire[]>("/debts"),
    financeConfig,
  );
}

export interface SavingsGoalWire {
  id: string;
  name: string;
  target_amount: string | number;
  saved_amount: string | number;
  currency: string;
  is_completed: boolean;
  target_date: string | null;
  description?: string | null;
  category_id?: string | null;
  color?: string | null;
}

export function useSavingsGoals() {
  return useSWR<SavingsGoalWire[]>(
    "finance/savings-goals",
    () => apiGet<SavingsGoalWire[]>("/savings-goals"),
    financeConfig,
  );
}

/** Manual balance write: `PATCH /api/accounts/{id} { balance }`. Amount travels
 * as a decimal string (e.g. `"980000.00"`); never a JSON number. */
export function patchAccount(id: string, body: { balance: string }): Promise<unknown> {
  return apiPatch(`/accounts/${id}`, body);
}

export interface CategoryWire {
  id: string;
  kind: string;
  name: string;
  color: string | null;
  icon: string | null;
  is_archived: boolean;
  created_at: string;
}

/** Fetch finance categories ordered by name (GET /categories?kind=finance). */
export function fetchFinanceCategories(): Promise<CategoryWire[]> {
  return apiGet<CategoryWire[]>("/categories?kind=finance");
}

export function useFinanceCategories() {
  return useSWR<CategoryWire[]>(
    "finance/categories-finance",
    fetchFinanceCategories,
    financeConfig,
  );
}

/** Physical delete of an empty account (DELETE /accounts/{id}). */
export function deleteAccount(id: string): Promise<void> {
  return apiDelete(`/accounts/${id}`);
}

// -- S5 escritura (montos string, allowlists reales PR-1, sin parseo local) --

export function patchGoal(id: string, body: Record<string, unknown>) { return apiPatch(`/savings-goals/${id}`, body); }
export function createMovement(goalId: string, input: { amount: string; occurred_on: string; notes?: string }) { return apiPost(`/savings-goals/${goalId}/movements`, input); }
export function deleteMovement(goalId: string, mid: string): Promise<void> { return apiDelete(`/savings-goals/${goalId}/movements/${mid}`); }

export interface DebtPaymentWire { id: string; debt_id: string; amount: string | number; paid_on: string; payment_method: string | null; notes: string | null; created_at: string }
export function patchDebt(id: string, body: Record<string, unknown>) { return apiPatch(`/debts/${id}`, body); }
export function createPayment(debtId: string, input: { amount: string; paid_on: string; payment_method?: string; notes?: string }) { return apiPost(`/debts/${debtId}/payments`, input); }
export function deletePayment(debtId: string, pid: string): Promise<void> { return apiDelete(`/debts/${debtId}/payments/${pid}`); }
export function fetchDebtPayments(debtId: string): Promise<DebtPaymentWire[]> { return apiGet<DebtPaymentWire[]>(`/debts/${debtId}/payments`); }
export function useDebtPayments(debtId: string | null) {
  return useSWR<DebtPaymentWire[]>(debtId ? `finance/debt-payments/${debtId}` : null, () => fetchDebtPayments(debtId as string), financeConfig);
}

export function createSubscription(input: Record<string, unknown>) { return apiPost("/subscriptions", input); }
export function setSubscriptionActive(id: string, is_active: boolean) { return apiPatch(`/subscriptions/${id}`, { is_active }); }
export function deleteSubscription(id: string): Promise<void> { return apiDelete(`/subscriptions/${id}`); }

export function createCard(input: { name: string; currency?: string; credit_limit: string; statement_day: number; payment_due_day: number; notes?: string }) {
  return apiPost("/accounts", { ...input, type: "credit_card" });
}

export interface AssetWire { id: string; name: string; category: string; account_id: string | null; currency: string; acquired_on: string | null; notes: string | null }
export function fetchAssets(): Promise<AssetWire[]> { return apiGet<AssetWire[]>("/assets"); }
export function useAssets() { return useSWR<AssetWire[]>("finance/assets", fetchAssets, financeConfig); }
export function patchAsset(id: string, body: Record<string, unknown>) { return apiPatch(`/assets/${id}`, body); }
export function createValuation(assetId: string, input: { value: string; recorded_on: string; notes?: string }) { return apiPost(`/assets/${assetId}/valuations`, input); }
