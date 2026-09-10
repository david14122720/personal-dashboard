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

export interface TransactionWire {
  id: string;
  account_id: string;
  type: string;
  amount: string | number;
  currency: string;
  occurred_on: string;
  category_id: string | null;
  description: string | null;
  notes: string | null;
  credit_card_account_id: string | null;
}

export interface TransactionListWire {
  items: TransactionWire[];
  next_cursor: string | null;
  total_count: number;
}

export interface TransactionFilters {
  account_id?: string;
  category_id?: string;
  type?: "income" | "expense";
  from?: string;
  to?: string;
  limit?: number;
}

const financeConfig: SWRConfiguration = { revalidateOnFocus: false };

/** Serialize ledger filters + opaque cursor into a `/transactions` path. */
export function buildTransactionsPath(filters: TransactionFilters, cursor: string | null): string {
  const params = new URLSearchParams();
  if (filters.account_id) params.set("account_id", filters.account_id);
  if (filters.category_id) params.set("category_id", filters.category_id);
  if (filters.type) params.set("type", filters.type);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `/transactions?${query}` : "/transactions";
}

/** Stable SWR key for a ledger page (filters + opaque cursor). */
export function transactionsPageKey(filters: TransactionFilters, cursor: string | null): string {
  return `finance${buildTransactionsPath(filters, cursor)}`;
}

/** Fetch one keyset page of the ledger. Cursor is forwarded opaquely. */
export function fetchTransactionsPage(
  filters: TransactionFilters,
  cursor: string | null,
): Promise<TransactionListWire> {
  return apiGet<TransactionListWire>(buildTransactionsPath(filters, cursor));
}

export function useTransactionsPage(filters: TransactionFilters, cursor: string | null) {
  return useSWR<TransactionListWire>(
    transactionsPageKey(filters, cursor),
    () => fetchTransactionsPage(filters, cursor),
    financeConfig,
  );
}

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

// -- S1 (captura manual en COP, sin UUIDs visibles) --

/** Wire payload for `POST /transactions` (income/expense). Amount travels as
 * a decimal string (e.g. `"150000.00"`); never a JSON number. */
export interface CreateTransactionInput {
  account_id: string;
  type: "income" | "expense";
  amount: string;
  occurred_on: string;
  category_id?: string | null;
  description?: string | null;
  payment_method?: string | null;
}

/** Create an income or expense. The caller passes the amount string verbatim. */
export function createTransaction(input: CreateTransactionInput): Promise<TransactionWire> {
  return apiPost<TransactionWire>("/transactions", {
    account_id: input.account_id,
    type: input.type,
    amount: input.amount,
    occurred_on: input.occurred_on,
    ...(input.category_id ? { category_id: input.category_id } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.payment_method ? { payment_method: input.payment_method } : {}),
  });
}

export interface TransferLegWire extends TransactionWire {}

export interface TransferCreateWire {
  transfer_group_id: string;
  legs: TransactionWire[];
}

export interface CreateTransferInput {
  from_account_id: string;
  to_account_id: string;
  amount: string;
  occurred_on: string;
  description?: string | null;
}

/** Create a transfer between two owned accounts (POST /transfers). */
export function createTransfer(input: CreateTransferInput): Promise<TransferCreateWire> {
  return apiPost<TransferCreateWire>("/transfers", {
    from_account_id: input.from_account_id,
    to_account_id: input.to_account_id,
    amount: input.amount,
    occurred_on: input.occurred_on,
    ...(input.description ? { description: input.description } : {}),
  });
}

export interface TransferHistoryWire {
  transfer_group_id: string;
  from_account_id: string;
  to_account_id: string;
  amount: string | number;
  currency: string;
  occurred_on: string;
  description: string | null;
  created_at: string;
}

export interface TransferListWire {
  items: TransferHistoryWire[];
  next_cursor: string | null;
  total_count: number;
}

export interface TransferFilters {
  from?: string;
  to?: string;
  limit?: number;
}

/** Serialize transfer filters + opaque cursor into a `/transfers` path. */
export function buildTransfersPath(filters: TransferFilters, cursor: string | null): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `/transfers?${query}` : "/transfers";
}

/** Stable SWR key for a transfer-history page (filters + opaque cursor). */
export function transfersPageKey(filters: TransferFilters, cursor: string | null): string {
  return `finance${buildTransfersPath(filters, cursor)}`;
}

/** Fetch one keyset page of the transfer history. Cursor is opaque. */
export function fetchTransfersPage(
  filters: TransferFilters,
  cursor: string | null,
): Promise<TransferListWire> {
  return apiGet<TransferListWire>(buildTransfersPath(filters, cursor));
}

export function useTransfersPage(filters: TransferFilters, cursor: string | null) {
  return useSWR<TransferListWire>(
    transfersPageKey(filters, cursor),
    () => fetchTransfersPage(filters, cursor),
    financeConfig,
  );
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

export interface CreateBudgetInput { category_id: string; amount: string; period_start: string; period_end: string; warn_threshold?: number; over_threshold?: number; notes?: string }
export function createBudget(input: CreateBudgetInput) { return apiPost("/budgets", input); }
export function patchBudget(id: string, body: Record<string, unknown>) { return apiPatch(`/budgets/${id}`, body); }
export function deleteBudget(id: string): Promise<void> { return apiDelete(`/budgets/${id}`); }

export function patchGoal(id: string, body: Record<string, unknown>) { return apiPatch(`/savings-goals/${id}`, body); }
export function createMovement(goalId: string, input: { amount: string; occurred_on: string; notes?: string }) { return apiPost(`/savings-goals/${goalId}/movements`, input); }
export function deleteMovement(goalId: string, mid: string): Promise<void> { return apiDelete(`/savings-goals/${goalId}/movements/${mid}`); }

export interface DebtPaymentWire { id: string; debt_id: string; amount: string | number; paid_on: string; payment_method: string | null; transaction_id: string | null; notes: string | null; created_at: string }
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
