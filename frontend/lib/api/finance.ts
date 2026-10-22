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
  /** Set by the pay action (`POST /subscriptions/{id}/pay`); absent on older rows. */
  last_paid_on?: string | null;
}

export function useSubscriptions() {
  return useSWR<SubscriptionWire[]>(
    "finance/subscriptions",
    () => apiGet<SubscriptionWire[]>("/subscriptions?shape=brief"),
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
}

/** Fetch finance categories ordered by name (GET /categories?kind=finance). */
export function fetchFinanceCategories(): Promise<CategoryWire[]> {
  return apiGet<CategoryWire[]>("/categories?kind=finance&shape=brief");
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
  return apiGet<CategoryWire[]>("/categories?kind=subscription&shape=brief");
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
    () => apiGet<MovementWire[]>("/movements?shape=brief"),
    financeConfig,
  );
}

/** Bounds of a ranged movements read (`YYYY-MM-DD`, inclusive on both edges
over `occurred_on`, the same semantics the trend buckets already filter by). */
export interface MovementRange {
  from: string;
  to: string;
}

/** SWR key for a range (`finance/movements:<from>:<to>`, the `habitsHistoryKey`
 * style); null when the range is missing or inverted so SWR stays idle. */
export function movementsRangeKey(range: MovementRange | null | undefined): string | null {
  if (!range?.from || !range?.to || range.from > range.to) return null;
  return `finance/movements:${range.from}:${range.to}`;
}

/** Ranged movements read (`GET /movements?from&to`). With neither bound the
 * backend answers byte-identical to the unfiltered read; unknown fields and
 * malformed dates are 422. `useMovements()` and its `"finance/movements"`
 * key stay untouched for the consumers without one bounded window. */
export function useMovementsRange(range: MovementRange | null | undefined) {
  const key = movementsRangeKey(range);
  return useSWR<MovementWire[]>(
    key,
    () => {
      const params = new URLSearchParams();
      params.set("from", (range as MovementRange).from);
      params.set("to", (range as MovementRange).to);
      return apiGet<MovementWire[]>(`/movements?${params.toString()}&shape=brief`);
    },
    financeConfig,
  );
}

// -- S1 (T5): server-side movement aggregates (`GET /movements/summary`) --

/** Bucket granularity of the summary read. */
export type MovementSummaryGroup = "day" | "week" | "month" | "year";

/** Echo of the requested summary window: inclusive `from`/`to` over
 * `occurred_on` (`YYYY-MM-DD`) plus the bucket granularity. */
export interface MovementSummaryQuery {
  from: string;
  to: string;
  group: MovementSummaryGroup;
}

/** Totals over the window. `expense`/`income` sum only user-currency
 * expense/income rows; `count` counts every movement, transfers included. */
export interface MovementSummaryTotalsWire {
  expense: string | number;
  income: string | number;
  count: number;
}

export interface MovementSummaryAccountWire {
  account_id: string;
  expense: string | number;
  income: string | number;
}

export interface MovementSummaryCategoryWire {
  category_id: string;
  expense: string | number;
  income: string | number;
}

/** One bucket of the window. `key` is `YYYY-MM-DD` (day), ISO `YYYY-Www`
 * (week), `YYYY-MM` (month) or `YYYY` (year). */
export interface MovementSummaryBucketWire {
  key: string;
  from: string;
  to: string;
  expense: string | number;
  income: string | number;
}

/** Payload of `GET /movements/summary`: final aggregates plus the five most
 * recent movements and the full-range movement count. */
export interface MovementSummaryWire {
  totals: MovementSummaryTotalsWire;
  by_account: MovementSummaryAccountWire[];
  by_category: MovementSummaryCategoryWire[];
  buckets: MovementSummaryBucketWire[];
  recent: MovementWire[];
  recent_total: number;
}

/** SWR key for a summary window (`finance/movements-summary:<from>:<to>:<group>`,
 * the `movementsRangeKey` style); null when the window is missing, inverted or
 * carries no valid group, so SWR stays idle. The prefix keeps the existing
 * `finance/movements` retry predicates working. */
export function movementsSummaryKey(
  query: MovementSummaryQuery | null | undefined,
): string | null {
  if (!query?.from || !query?.to || !query?.group || query.from > query.to) return null;
  return `finance/movements-summary:${query.from}:${query.to}:${query.group}`;
}

/** Aggregated movements read (`GET /movements/summary?from&to&group`).
 * The server applies the single-currency rule and excludes transfers from the
 * `expense`/`income` sums, so consumers never re-filter or re-aggregate. */
export function useMovementsSummary(query: MovementSummaryQuery | null | undefined) {
  const key = movementsSummaryKey(query);
  return useSWR<MovementSummaryWire>(
    key,
    () => {
      const params = new URLSearchParams();
      params.set("from", (query as MovementSummaryQuery).from);
      params.set("to", (query as MovementSummaryQuery).to);
      params.set("group", (query as MovementSummaryQuery).group);
      return apiGet<MovementSummaryWire>(`/movements/summary?${params.toString()}`);
    },
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
  return apiGet<CategoryWire[]>("/categories?shape=brief");
}

export function useCategories() {
  return useSWR<CategoryWire[]>(
    "finance/categories",
    fetchCategories,
    financeConfig,
  );
}

/** Create a finance category (`POST /categories { name, kind: "finance" }`).
 * Ajustes-created categories are always `finance`; the backend trims and
 * validates the name (1-80 chars) and answers 409 on duplicates. */
export function createCategory(name: string): Promise<CategoryWire> {
  return apiPost<CategoryWire>("/categories", { name, kind: "finance" });
}

/** Delete an owned category (`DELETE /categories/{id}`). Referencing
 * movements keep their audit (`category_id` SET NULL server-side). */
export function deleteCategory(id: string): Promise<void> {
  return apiDelete(`/categories/${id}`);
}

/** Create an account by name/alias (`POST /accounts {name}`). The new account
 * appears automatically in Finanzas (same `dashboard/accounts` read). */
export function createBankAccount(name: string) {
  return apiPost("/accounts", { name });
}

export interface AssetWire { id: string; name: string; category: string; account_id: string | null; currency: string; acquired_on: string | null; notes: string | null }
export function fetchAssets(): Promise<AssetWire[]> { return apiGet<AssetWire[]>("/assets?shape=brief"); }
export function useAssets() { return useSWR<AssetWire[]>("finance/assets", fetchAssets, financeConfig); }
export function patchAsset(id: string, body: Record<string, unknown>) { return apiPatch(`/assets/${id}`, body); }
export function createValuation(assetId: string, input: { value: string; recorded_on: string; notes?: string }) { return apiPost(`/assets/${assetId}/valuations`, input); }
