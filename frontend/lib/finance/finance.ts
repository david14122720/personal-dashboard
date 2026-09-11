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

export interface DebtProgress { paid: number; remaining: number; pct: number; status: "ok" | "warn" | "paid"; }

/** Debo/aboné/falta desde montos ya coercionados. pct clamp [0,1]; paid si pending<=0, warn si pct>=0.7. */
export function toDebtProgress(d: { original: number; pending: number }): DebtProgress {
  const paid = d.original - d.pending;
  const raw = d.original > 0 ? paid / d.original : 0;
  const pct = Math.min(1, Math.max(0, raw));
  const status = d.pending <= 0 ? "paid" : pct >= 0.7 ? "warn" : "ok";
  return { paid, remaining: d.pending, pct, status };
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

// -- PR-3 S6 puros (periodo + series + MoM + insights, sin JSX, sin fetch) --

export type PeriodKind = "week" | "month" | "quarter" | "year" | "custom";
export interface PeriodSel {
  kind: PeriodKind;
  from?: string;
  to?: string;
}

function pad2(n: number): string {
  return `${n}`.padStart(2, "0");
}

function toISODateLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isValidDayStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** Periodo selector → rango from/to YYYY-MM-DD. custom valida from<=to y formato. */
export function toPeriodRange(sel: PeriodSel, now: Date = new Date()): { from: string; to: string } {
  const today = toISODateLocal(now);
  switch (sel.kind) {
    case "week": {
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const start = new Date(end);
      start.setDate(end.getDate() - 6);
      return { from: toISODateLocal(start), to: toISODateLocal(end) };
    }
    case "month": {
      const y = now.getFullYear();
      const m = now.getMonth();
      const last = new Date(y, m + 1, 0).getDate();
      return { from: `${y}-${pad2(m + 1)}-01`, to: `${y}-${pad2(m + 1)}-${pad2(last)}` };
    }
    case "quarter": {
      const y = now.getFullYear();
      const qStart = Math.floor(now.getMonth() / 3) * 3;
      const last = new Date(y, qStart + 3, 0).getDate();
      const endMonth = qStart + 2;
      return {
        from: `${y}-${pad2(qStart + 1)}-01`,
        to: `${y}-${pad2(endMonth + 1)}-${pad2(last)}`,
      };
    }
    case "year": {
      const y = now.getFullYear();
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    case "custom": {
      const from = (sel.from ?? "").trim();
      const to = (sel.to ?? "").trim();
      if (!isValidDayStr(from) || !isValidDayStr(to) || from > to) {
        throw new Error(`Invalid custom range: ${from}..${to}`);
      }
      return { from, to };
    }
    default:
      void today;
      throw new Error(`Unknown period kind: ${(sel as PeriodSel).kind}`);
  }
}

/**
 * Rango de fechas `YYYY-MM-DD` → rango RFC 3339 para `GET /events`, cuyo backend
 * exige un datetime RFC 3339 (una fecha desnuda es 422) y filtra por solape con
 * `starts_at < to` / `ends_at > from`.
 */
export function toEventRange(range: { from: string; to: string }): { from: string; to: string } {
  return { from: `${range.from}T00:00:00.000Z`, to: `${range.to}T23:59:59.999Z` };
}

export interface FlowLike {
  month: string;
  income: string | number;
  expense: string | number;
}

/** Variación intermensual: delta=cur-prev, pct=null si prev==0. */
export function toMonthOverMonth(cur: number, prev: number): { delta: number; pct: number | null } {
  const delta = cur - prev;
  if (prev === 0) return { delta, pct: null };
  return { delta, pct: delta / prev };
}

/** Ahorro por mes income-expense (admite negativo, coerción solo aquí). */
export function toSavingsSeries(flow: FlowLike[] | null | undefined): { month: string; savings: number }[] {
  if (!flow) return [];
  return [...flow]
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
    .map((row) => ({ month: row.month, savings: toNumber(row.income) - toNumber(row.expense) }));
}

/** Balance acumulado cronológico desde monthly-flow. */
export function toBalanceSeries(flow: FlowLike[] | null | undefined): { month: string; balance: number }[] {
  if (!flow) return [];
  const sorted = [...flow].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  let acc = 0;
  return sorted.map((row) => {
    acc += toNumber(row.income) - toNumber(row.expense);
    return { month: row.month, balance: acc };
  });
}

/** Gasto por mes (columna expense) con coerción solo aquí. */
export function toExpenseSeries(flow: FlowLike[] | null | undefined): { month: string; expense: number }[] {
  if (!flow) return [];
  return [...flow]
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
    .map((row) => ({ month: row.month, expense: toNumber(row.expense) }));
}

export interface MonthCompare {
  cur: number;
  prev: number;
  deltaPct: number | null;
  curMonth: string;
  prevMonth: string;
}

/** Últimos 2 meses con datos (gasto): <2 → null. */
export function toMonthCompare(flow: FlowLike[] | null | undefined): MonthCompare | null {
  if (!flow || flow.length < 2) return null;
  const sorted = [...flow].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  const prevRow = sorted[sorted.length - 2];
  const curRow = sorted[sorted.length - 1];
  const prev = toNumber(prevRow.expense);
  const cur = toNumber(curRow.expense);
  return {
    cur,
    prev,
    deltaPct: prev === 0 ? null : (cur - prev) / prev,
    curMonth: curRow.month,
    prevMonth: prevRow.month,
  };
}

export interface CategoryTotalLike {
  name: string;
  total: string | number;
}

export interface BudgetInsightLike {
  id: string;
  label: string;
  spent: number;
  amount: number;
  pct: number;
  status: string;
}

export type MomDirection = "up" | "down" | "flat";

export interface Insight {
  id: string;
  kind: "mom-expense" | "mom-expense-up" | "mom-expense-down" | "mom-expense-flat" | "savings-rate" | "recurrent" | "worst-month" | "best-month" | "avg-expense" | "budget";
  vars: Record<string, string | number>;
}

export interface InsightsInput {
  flow: FlowLike[] | null | undefined;
  byCatExpense: CategoryTotalLike[] | null | undefined;
  byCatIncome?: CategoryTotalLike[] | null | undefined;
  budgets?: BudgetInsightLike[] | null | undefined;
  descriptions?: string[] | null | undefined;
}

/** Insights directos (máx 6, ordenados). Recurrente v1: frecuencia description ≥3, si no concluye se omite. */
export function toInsights(input: InsightsInput): Insight[] {
  const flow = input.flow ? [...input.flow].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0)) : [];
  if (flow.length === 0) return [];
  const out: Insight[] = [];
  const topExpense = (input.byCatExpense ?? []).reduce<CategoryTotalLike | null>((best, row) => {
    if (!best) return row;
    return toNumber(row.total) > toNumber(best.total) ? row : best;
  }, null);
  const topName = topExpense?.name ?? "—";
  if (flow.length >= 2) {
    const cur = toNumber(flow[flow.length - 1].expense);
    const prev = toNumber(flow[flow.length - 2].expense);
    const { pct } = toMonthOverMonth(cur, prev);
    // JD-INSIGHT: dirección por comparación directa + pct absoluto (cero neutro).
    const dir: MomDirection = cur > prev ? "up" : cur < prev ? "down" : "flat";
    const absPct = pct === null ? 0 : Math.abs(Math.round(pct * 100));
    out.push({
      id: "insight-mom-expense",
      kind: "mom-expense",
      vars: { pct: absPct, dir, cat: topName, cur, prev },
    });
  }
  const last = flow[flow.length - 1];
  const lastIncome = toNumber(last.income);
  const lastExpense = toNumber(last.expense);
  if (lastIncome > 0) {
    const saved = lastIncome - lastExpense;
    out.push({
      id: "insight-savings-rate",
      kind: "savings-rate",
      vars: { n: Math.round((saved / lastIncome) * 100), saved, income: lastIncome },
    });
  }
  const descs = (input.descriptions ?? []).map((d) => d.trim()).filter(Boolean);
  if (descs.length > 0) {
    const freq = new Map<string, number>();
    for (const d of descs) freq.set(d, (freq.get(d) ?? 0) + 1);
    let bestName = "";
    let bestCount = 0;
    for (const [name, count] of freq) {
      if (count > bestCount) {
        bestCount = count;
        bestName = name;
      }
    }
    if (bestCount >= 3) {
      out.push({ id: "insight-recurrent", kind: "recurrent", vars: { name: bestName, count: bestCount } });
    }
  }
  let worst = flow[0];
  let best = flow[0];
  let bestSaving = toNumber(flow[0].income) - toNumber(flow[0].expense);
  let sum = 0;
  for (const row of flow) {
    const exp = toNumber(row.expense);
    sum += exp;
    if (exp > toNumber(worst.expense)) worst = row;
    const saving = toNumber(row.income) - toNumber(row.expense);
    if (saving > bestSaving) {
      bestSaving = saving;
      best = row;
    }
  }
  out.push({ id: "insight-worst-month", kind: "worst-month", vars: { mes: worst.month, amount: toNumber(worst.expense) } });
  out.push({ id: "insight-best-month", kind: "best-month", vars: { mes: best.month, amount: bestSaving } });
  out.push({ id: "insight-avg-expense", kind: "avg-expense", vars: { amount: Math.round(sum / flow.length) } });
  const flagged = (input.budgets ?? [])
    .filter((b) => b.status === "over" || b.status === "warn")
    .sort((a, b) => b.pct - a.pct)[0];
  if (flagged) {
    out.push({
      id: "insight-budget",
      kind: "budget",
      vars: { n: Math.round(flagged.pct * 100), label: flagged.label, spent: flagged.spent, amount: flagged.amount },
    });
  }
  return out.slice(0, 6);
}
