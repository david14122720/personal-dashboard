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
import { apiGet } from "@/lib/api/client";

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
}

export function useSavingsGoals() {
  return useSWR<SavingsGoalWire[]>(
    "finance/savings-goals",
    () => apiGet<SavingsGoalWire[]>("/savings-goals"),
    financeConfig,
  );
}
