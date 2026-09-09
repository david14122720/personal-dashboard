/**
 * Finance transform boundary for `/dashboard/finance`.
 *
 * Wire money arrives as decimal STRINGS (e.g. "50.00"). These pure helpers
 * are the only place (besides `lib/api/money.ts`) that coerce finance
 * payloads to numbers. UI components receive numbers only — they never
 * parse strings themselves. LED classes are reused from
 * `lib/dashboard/transforms.ts` (`ledDotClass`); this module maps no enums.
 */

import { toNumber } from "@/lib/api/money";
import type {
  CategoryWire,
  DebtWire,
  SavingsGoalWire,
  SubscriptionWire,
  TransactionFilters,
  TransactionWire,
  TransferFilters,
  TransferHistoryWire,
} from "@/lib/api/finance";
import type { AccountWire } from "@/lib/api/dashboard";

export interface LedgerRow {
  id: string;
  occurred_on: string;
  description: string;
  type: string;
  amount: number;
  currency: string;
}

/** Coerce one ledger page to render-ready rows (numbers only). */
export function toLedgerRows(items: TransactionWire[] | null | undefined): LedgerRow[] {
  if (!items) return [];
  return items.map((item) => ({
    id: item.id,
    occurred_on: item.occurred_on,
    description: item.description ?? "—",
    type: item.type,
    amount: toNumber(item.amount),
    currency: item.currency,
  }));
}

/** Stable React key that resets ledger pagination when filters change. */
export function ledgerKey(filters: TransactionFilters): string {
  return [
    filters.account_id ?? "",
    filters.category_id ?? "",
    filters.type ?? "",
    filters.from ?? "",
    filters.to ?? "",
    String(filters.limit ?? ""),
  ].join("|");
}

export interface BudgetView {
  id: string;
  label: string;
  spent: number;
  remaining: number;
  /** Spend fraction clamped to [0, 1] for progress-bar width. */
  pct: number;
  status: string;
  currency: string;
}

export interface BudgetWireLike {
  id: string;
  category_id: string;
  amount: string | number;
  currency: string;
  period_start: string;
  spent: string | number;
  remaining: string | number;
  pct: number;
  status: string;
}

/** Coerce budget status payloads to progress-bar view models. */
export function toBudgetViews(rows: BudgetWireLike[] | null | undefined): BudgetView[] {
  if (!rows) return [];
  return rows.map((row) => {
    const pct = Number.isFinite(row.pct) ? row.pct : 0;
    return {
      id: row.id,
      label: `${row.currency} ${toNumber(row.amount).toFixed(0)} · ${row.period_start}`,
      spent: toNumber(row.spent),
      remaining: toNumber(row.remaining),
      pct: Math.min(1, Math.max(0, pct)),
      status: row.status,
      currency: row.currency,
    };
  });
}

export interface AccountCardView {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: number;
  isCard: boolean;
  used: number | null;
  available: number | null;
  /** Usage percent as reported by the API, or null for non-card accounts. */
  usagePct: number | null;
  alertLevel: string | null;
  statementBalance: number | null;
}

export interface AccountWireLike extends AccountWire {
  credit_limit?: string | number | null;
  used_balance?: string | number | null;
  available_balance?: string | number | null;
  usage_pct?: string | number | null;
  statement_balance?: string | number | null;
}

/** Coerce account payloads (with card usage metrics) to card view models. */
export function toAccountCards(rows: AccountWireLike[] | null | undefined): AccountCardView[] {
  if (!rows) return [];
  return rows.map((row) => {
    const isCard = row.type === "credit_card";
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      currency: row.currency,
      balance: toNumber(row.balance),
      isCard,
      used: row.used_balance == null ? null : toNumber(row.used_balance),
      available: row.available_balance == null ? null : toNumber(row.available_balance),
      usagePct: row.usage_pct == null ? null : toNumber(row.usage_pct),
      alertLevel: row.alert_level ?? null,
      statementBalance: row.statement_balance == null ? null : toNumber(row.statement_balance),
    };
  });
}

export interface CompactMoneyRow {
  id: string;
  title: string;
  detail: string | null;
  amount: number;
  currency: string;
}

/** Active subscriptions as compact money rows. */
export function toSubscriptionRows(
  rows: SubscriptionWire[] | null | undefined,
): CompactMoneyRow[] {
  if (!rows) return [];
  return rows
    .filter((row) => row.is_active)
    .map((row) => ({
      id: row.id,
      title: row.name,
      detail: row.next_billing_on ? `Next billing ${row.next_billing_on} · ${row.frequency}` : row.frequency,
      amount: toNumber(row.price),
      currency: row.currency,
    }));
}

/** Debts as compact money rows showing the pending remainder. */
export function toDebtRows(rows: DebtWire[] | null | undefined): CompactMoneyRow[] {
  if (!rows) return [];
  return rows.map((row) => ({
    id: row.id,
    title: `${row.name} · ${row.creditor}`,
    detail: row.due_date ? `Due ${row.due_date} · ${row.status}` : row.status,
    amount: toNumber(row.pending_amount),
    currency: row.currency,
  }));
}

export interface SavingsView extends CompactMoneyRow {
  /** Completion fraction clamped to [0, 1] for progress-bar width. */
  progress: number;
  completed: boolean;
}

/** Savings goals with completion progress. */
export function toSavingsViews(rows: SavingsGoalWire[] | null | undefined): SavingsView[] {
  if (!rows) return [];
  return rows.map((row) => {
    const target = toNumber(row.target_amount);
    const saved = toNumber(row.saved_amount);
    const raw = target > 0 ? saved / target : 0;
    return {
      id: row.id,
      title: row.name,
      detail: row.target_date ? `Target ${row.target_date}` : null,
      amount: saved,
      currency: row.currency,
      progress: Math.min(1, Math.max(0, raw)),
      completed: row.is_completed,
    };
  });
}

// -- S1 (captura manual en COP, sin UUIDs visibles) --

export interface TransferRow {
  id: string;
  occurred_on: string;
  from_account_id: string;
  to_account_id: string;
  description: string;
  amount: number;
  currency: string;
}

/** Coerce one transfer-history page to render-ready rows (numbers only). */
export function toTransferRows(
  items: TransferHistoryWire[] | null | undefined,
): TransferRow[] {
  if (!items) return [];
  return items.map((item) => ({
    id: item.transfer_group_id,
    occurred_on: item.occurred_on,
    from_account_id: item.from_account_id,
    to_account_id: item.to_account_id,
    description: item.description ?? "—",
    amount: toNumber(item.amount),
    currency: item.currency,
  }));
}

/** Stable React key that resets transfer pagination when filters change. */
export function transferKey(filters: TransferFilters): string {
  return [filters.from ?? "", filters.to ?? "", String(filters.limit ?? "")].join("|");
}

export interface NamedOption {
  id: string;
  name: string;
}

/** Accounts/categories as name-sorted selector options (never raw UUID inputs). */
export function toAccountOptions(
  rows: { id: string; name: string }[] | null | undefined,
): NamedOption[] {
  if (!rows) return [];
  return [...rows]
    .map((row) => ({ id: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function toCategoryOptions(
  rows: CategoryWire[] | null | undefined,
): NamedOption[] {
  if (!rows) return [];
  return [...rows]
    .map((row) => ({ id: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/**
 * Normalize a hand-typed COP amount to a wire string. Accepts digits with an
 * optional decimal part of up to 2 places (e.g. `"150000"`, `"150000.50"`).
 * Returns the trimmed string for the API, or null when the input is not a
 * positive amount (the form then shows a Spanish inline error).
 */
export function normalizeManualAmount(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().replace(/\s+/g, "");
  if (!trimmed) return null;
  // Allow thousand separators the user may type by hand (dots/commas) only
  // when they are unambiguous: strip plain thousand dots for COP, keep the
  // decimal part. Keep it simple: remove commas, then validate shape.
  const compact = trimmed.replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(compact)) return null;
  const value = Number(compact);
  if (!Number.isFinite(value) || value <= 0) return null;
  return compact;
}
