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
  /** Set by the pay action (`POST /subscriptions/{id}/pay`); absent on older rows. */
  last_paid_on?: string | null;
}

export function useSubscriptions() {
  return useSWR<SubscriptionWire[]>(
    "finance/subscriptions",
    () => apiGet<SubscriptionWire[]>("/subscriptions"),
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

/** Fetch subscription categories ordered by name (GET /categories?kind=subscription).
 * Own SWR key so each classification select dedups/caches independently. */
export function fetchSubscriptionCategories(): Promise<CategoryWire[]> {
  return apiGet<CategoryWire[]>("/categories?kind=subscription");
}

export function useSubscriptionCategories() {
  return useSWR<CategoryWire[]>(
    "finance/categories-subscription",
    fetchSubscriptionCategories,
    financeConfig,
  );
}

/** Physical delete of an empty account (DELETE /accounts/{id}). */
export function deleteAccount(id: string): Promise<void> {
  return apiDelete(`/accounts/${id}`);
}

export function createSubscription(input: Record<string, unknown>) { return apiPost("/subscriptions", input); }
export function setSubscriptionActive(id: string, is_active: boolean) { return apiPatch(`/subscriptions/${id}`, { is_active }); }
export function deleteSubscription(id: string): Promise<void> { return apiDelete(`/subscriptions/${id}`); }

/** Widened subscription metadata write (S-D owns the tests): exactly
 * `name|price|next_billing_on|is_active`, omitted fields keep their value. */
export function patchSubscription(
  id: string,
  body: { name?: string; price?: string; next_billing_on?: string; is_active?: boolean },
): Promise<SubscriptionWire> {
  return apiPatch<SubscriptionWire>(`/subscriptions/${id}`, body);
}

/** Pay action (S-D owns the tests): debits the account, inserts the audit
 * movement and advances the cycle. The body carries only `{account_id}`. */
export function paySubscription(id: string, accountId: string): Promise<SubscriptionWire> {
  return apiPost<SubscriptionWire>(`/subscriptions/${id}/pay`, { account_id: accountId });
}

// -- Movements ledger (S-C): expense/income records with atomic balance effect --

/** Direction of a ledger row: an expense or income movement, or a transfer
 * between two own accounts (`account_id` is the origin and
 * `transfer_account_id` the destination). */
export type MovementDirection = "expense" | "income" | "transfer";

/** Movement row as served by `GET /movements`: amount is a decimal string
 * (e.g. `"25000.00"`), `occurred_on` is `YYYY-MM-DD`. */
export interface MovementWire {
  id: string;
  direction: MovementDirection;
  amount: string | number;
  occurred_on: string;
  description: string | null;
  account_id: string;
  /** Transfer destination (the origin is `account_id`); `null` for
   * expense/income. Optional so payloads without the transfer extension
   * still type-check; the backend always serializes it. */
  transfer_account_id?: string | null;
  category_id: string | null;
  subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

/** `POST /movements` stays a two-direction contract: transfers are created
 * only through `createTransfer` (D2.1). */
export interface CreateMovementInput {
  direction: "expense" | "income";
  amount: string;
  account_id: string;
  category_id: string;
  occurred_on: string;
  description?: string;
}

/** Patches are expense/income only: a stored transfer is rejected by the
 * backend and never sends `transfer_account_id` (D2.4). */
export interface PatchMovementInput {
  direction?: "expense" | "income";
  amount?: string;
  account_id?: string;
  category_id?: string;
  occurred_on?: string;
  description?: string;
}

/** All movements of the caller in API order (`occurred_on DESC,
 * `created_at DESC, `id DESC`); no pagination in v1. */
export function useMovements() {
  return useSWR<MovementWire[]>(
    "finance/movements",
    () => apiGet<MovementWire[]>("/movements"),
    financeConfig,
  );
}

/** Create a movement (amount travels as a decimal string, never a number). */
export function createMovement(input: CreateMovementInput): Promise<MovementWire> {
  return apiPost<MovementWire>("/movements", input);
}

/** Exact request contract of `POST /movements/transfer` (deny_unknown_fields:
 * `direction`, `category_id`, `subscription_id` and `transfer_account_id` are
 * rejected as unknown). */
export interface CreateTransferInput {
  from_account_id: string;
  to_account_id: string;
  amount: string;
  occurred_on: string;
  description?: string;
}

/** Create a transfer: one ledger row with the origin in `account_id` and the
 * destination in `transfer_account_id`; the backend debits the origin and
 * credits the destination atomically. Transfers cannot be edited (delete and
 * recreate), so there is no `patchTransfer`. */
export function createTransfer(input: CreateTransferInput): Promise<MovementWire> {
  return apiPost<MovementWire>("/movements/transfer", input);
}

/** Edit a movement; omitted fields keep their stored value. */
export function patchMovement(id: string, body: PatchMovementInput): Promise<MovementWire> {
  return apiPatch<MovementWire>(`/movements/${id}`, body);
}

/** Delete a movement and reverse its balance effect. */
export function deleteMovement(id: string): Promise<void> {
  return apiDelete(`/movements/${id}`);
}

// -- Kind-free categories (S-C): one unfiltered set for every picker/chart --

/** Fetch every owned category in one unfiltered set (`GET /categories`,
 * no `kind` param), ordered by name. */
export function fetchCategories(): Promise<CategoryWire[]> {
  return apiGet<CategoryWire[]>("/categories");
}

export function useCategories() {
  return useSWR<CategoryWire[]>(
    "finance/categories",
    fetchCategories,
    financeConfig,
  );
}

/** Create an account by name/alias (`POST /accounts {name}`). The new account
 * appears automatically in Finanzas (same `dashboard/accounts` read). */
export function createBankAccount(name: string) {
  return apiPost("/accounts", { name });
}

export interface AssetWire { id: string; name: string; category: string; account_id: string | null; currency: string; acquired_on: string | null; notes: string | null }
export function fetchAssets(): Promise<AssetWire[]> { return apiGet<AssetWire[]>("/assets"); }
export function useAssets() { return useSWR<AssetWire[]>("finance/assets", fetchAssets, financeConfig); }
export function patchAsset(id: string, body: Record<string, unknown>) { return apiPatch(`/assets/${id}`, body); }
export function createValuation(assetId: string, input: { value: string; recorded_on: string; notes?: string }) { return apiPost(`/assets/${assetId}/valuations`, input); }
