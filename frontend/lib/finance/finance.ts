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
  MovementWire,
  SubscriptionWire,
} from "@/lib/api/finance";
import type { AccountWire } from "@/lib/api/dashboard";

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

/** Monthly-equivalent factor per subscription frequency (mirrors `toMonthlyCost`).
 * Unknown frequencies return null so callers fall back to the raw price. */
export function subscriptionMonthlyFactor(frequency: string | null | undefined): number | null {
  switch (frequency) {
    case "daily": return 30;
    case "weekly": return 52 / 12;
    case "biweekly": return 26 / 12;
    case "monthly": return 1;
    case "quarterly": return 1 / 3;
    case "semiannual": return 1 / 6;
    case "annual": return 1 / 12;
    default: return null;
  }
}

/** Raw price coerced to its monthly equivalent (unknown frequency → raw price). */
export function toMonthlyPrice(price: string | number | null | undefined, frequency: string | null | undefined): number {
  return toNumber(price) * (subscriptionMonthlyFactor(frequency) ?? 1);
}

/** Active subscriptions as compact money rows (simplified view): title is the
 * name, detail is only the next billing date (or null), amount is the
 * monthly-equivalent price. No frequency, status, icon or category is shown. */
export function toSubscriptionRows(
  rows: SubscriptionWire[] | null | undefined,
): CompactMoneyRow[] {
  if (!rows) return [];
  return rows
    .filter((row) => row.is_active)
    .map((row) => ({
      id: row.id,
      title: row.name,
      detail: row.next_billing_on ?? null,
      amount: toMonthlyPrice(row.price, row.frequency),
      currency: row.currency,
    }));
}

// -- S1 (captura manual en COP, sin UUIDs visibles) --

export interface NamedOption {
  id: string;
  name: string;
  /** Backend category kind (`finance`, `subscription`, …). Preserved so
   * callers can filter defensively; never sent back to the API. */
  kind?: string;
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
    .map((row) => ({ id: row.id, name: row.name, kind: row.kind }))
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

// -- Movements ledger (S-C): rows, aggregates, Bogota dates, paid derivation --

/** One movement ready to render: numbers only, names resolved. `displayDate`
 * is the Spanish rendering of `occurredOn` (see `formatMovementDate`); money
 * itself stays a number and components format it with `formatMoney`. */
export interface MovementRowView {
  id: string;
  direction: "expense" | "income";
  amount: number;
  occurredOn: string;
  displayDate: string;
  description: string | null;
  accountName: string;
  categoryName: string | null;
}

/** `YYYY-MM-DD` → Spanish date (e.g. `24 sept 2026`). The input is parsed as
 * calendar fields (never `new Date(str)`, which is UTC-midnight and shifts
 * the day under American timezones); unparseable input passes through. */
export function formatMovementDate(occurredOn: string, locale = "es-CO"): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(occurredOn.trim());
  if (!match) return occurredOn;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return occurredOn;
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "America/Bogota",
    }).format(date);
  } catch {
    return occurredOn;
  }
}

/** Movement wires → render rows. Unknown account/category ids fall back to
 * the raw id (never blank); a null category stays null so aggregates can
 * exclude it. Rows keep API order — callers slice (never re-sort). */
export function toMovementRows(
  movements: MovementWire[] | null | undefined,
  accounts: NamedOption[],
  categories: NamedOption[],
  locale = "es-CO",
): MovementRowView[] {
  if (!movements) return [];
  const accountById = new Map(accounts.map((a) => [a.id, a.name]));
  const categoryById = new Map(categories.map((c) => [c.id, c.name]));
  return movements.map((m) => ({
    id: m.id,
    direction: m.direction,
    amount: toNumber(m.amount),
    occurredOn: m.occurred_on,
    displayDate: formatMovementDate(m.occurred_on, locale),
    description: m.description,
    accountName: accountById.get(m.account_id) ?? m.account_id,
    categoryName: m.category_id == null ? null : (categoryById.get(m.category_id) ?? m.category_id),
  }));
}

export interface CategoryMovementTotals {
  expense: number;
  income: number;
}

/** Per-category expense/income over movements, never netted. Rows without a
 * category are excluded (no "sin categoría" bucket); rows on accounts whose
 * currency differs from the user currency are excluded, never converted. */
export function toCategoryMovementTotals(
  movements: MovementWire[] | null | undefined,
  currencyByAccountId: Map<string, string>,
  userCurrency: string,
  categoryId: string,
): CategoryMovementTotals {
  let expense = 0;
  let income = 0;
  for (const m of movements ?? []) {
    if ((m.category_id ?? null) !== categoryId) continue;
    if ((currencyByAccountId.get(m.account_id) ?? userCurrency) !== userCurrency) continue;
    const amount = toNumber(m.amount);
    if (m.direction === "expense") expense += amount;
    else income += amount;
  }
  return { expense, income };
}

/** Total balance: Σ `accounts.balance` over same-currency accounts only.
 * Foreign-currency accounts are excluded, never converted. */
export function toTotalBalance(
  accounts: AccountCardView[] | null | undefined,
  currency: string,
): number {
  let total = 0;
  for (const account of accounts ?? []) {
    if (account.currency !== currency) continue;
    total += account.balance;
  }
  return total;
}

/** Today in America/Bogota as `YYYY-MM-DD` (`Intl` `en-CA` yields the ISO
 * shape directly). Colombia has no DST, but the zone-aware formatter keeps
 * the boundary exact without a date library. */
export function todayInBogota(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Paid-this-cycle, derived at render time (no effects, no timers): the pay
 * action stamped `last_paid_on` and advanced `next_billing_on` past today.
 * Plain string comparison is exact for `YYYY-MM-DD`. */
export function isPaidThisCycle(
  sub: { last_paid_on: string | null; next_billing_on: string | null },
  today: string,
): boolean {
  return sub.last_paid_on != null && sub.next_billing_on != null && sub.next_billing_on > today;
}
