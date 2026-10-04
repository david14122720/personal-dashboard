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
  MovementDirection,
  MovementWire,
  SubscriptionWire,
} from "@/lib/api/finance";
import type { AccountWire } from "@/lib/api/dashboard";

export interface AccountCardView {
  id: string;
  name: string;
  currency: string;
  balance: number;
}

/** Coerce account payloads to the type-free view model (W1: no card branch,
 * no card metric). The name stays for review focus; renaming is a non-goal. */
export function toAccountCards(rows: AccountWire[] | null | undefined): AccountCardView[] {
  if (!rows) return [];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    currency: row.currency,
    balance: toNumber(row.balance),
  }));
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
 * Normalize a hand-typed COP amount to a wire string. Accepted shapes:
 * plain digits with optional dot decimals (`"150000"`, `"150000.50"`),
 * COP thousands dots with optional comma decimals (`"3.500.000"`,
 * `"1.500.000,50"`), US thousands commas with optional dot decimals
 * (`"1,500,000.50"`), and a lone decimal comma (`"25,50"`, `"0,01"`).
 * Spaces are stripped. Returns the numeric wire string with at most 2
 * decimals, or null when the input is not a positive amount (the form
 * then shows a Spanish inline error).
 */
export function normalizeManualAmount(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = raw.trim().replace(/\s+/g, "");
  if (!s) return null;
  let compact = s;
  // COP style: dots as thousands, optional comma decimals ("3.500.000", "1.500.000,50")
  if (/^[1-9]\d{0,2}(\.\d{3})+(,\d{1,2})?$/.test(s)) compact = s.replace(/\./g, "").replace(",", ".");
  // US style: commas as thousands, optional dot decimals ("1,500,000.50")
  else if (/^[1-9]\d{0,2}(,\d{3})+(\.\d{1,2})?$/.test(s)) compact = s.replace(/,/g, "");
  // decimal comma only ("25,50", "0,01")
  else if (/^\d+,\d{1,2}$/.test(s)) compact = s.replace(",", ".");
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

/** Shift a `YYYY-MM-DD` by whole UTC days; invalid input passes through. */
function shiftDay(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const shifted = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  );
  return shifted.toISOString().slice(0, 10);
}

/**
 * Rango de fechas `YYYY-MM-DD` → rango RFC 3339 para `GET /events`, cuyo backend
 * exige un datetime RFC 3339 (una fecha desnuda es 422) y filtra por solape con
 * `starts_at < to` / `ends_at > from`.
 *
 * `marginDays` widens both edges by whole days before converting. Local-day
 * grids bucket client-side in the browser timezone, so a query pinned to UTC
 * midnight can drop an event that belongs to a visible local day near the
 * edges; calendar callers pass 1. Day-precision callers keep the default 0.
 */
export function toEventRange(
  range: { from: string; to: string },
  marginDays = 0,
): { from: string; to: string } {
  const from = marginDays > 0 ? shiftDay(range.from, -marginDays) : range.from;
  const to = marginDays > 0 ? shiftDay(range.to, marginDays) : range.to;
  return { from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` };
}

// -- Movements ledger (S-C): rows, aggregates, Bogota dates, paid derivation --

/** One movement ready to render: numbers only, names resolved. `displayDate`
 * is the Spanish rendering of `occurredOn` (see `formatMovementDate`); money
 * itself stays a number and components format it with `formatMoney`.
 * A transfer keeps `direction: "transfer"` (never re-labelled as income),
 * resolves its destination into `transferAccountName` from the same account
 * map as the origin, and is create/delete only (`editable: false`, D2.4). */
export interface MovementRowView {
  id: string;
  direction: MovementDirection;
  amount: number;
  occurredOn: string;
  displayDate: string;
  description: string | null;
  accountName: string;
  /** Transfer destination name; `null` for expense/income rows and for a
   * transfer whose destination is absent from the current account map (see
   * `transferAccountUnknown`). */
  transferAccountName: string | null;
  /** `true` only for a transfer whose destination account is missing from
   * the map (archived/removed): renderers show an explicit marker instead of
   * a raw identifier. `false` otherwise. */
  transferAccountUnknown: boolean;
  /** `false` for transfers: the renderer offers no edit affordance (D2.4). */
  editable: boolean;
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
 * exclude it. A transfer resolves `transfer_account_id` through the same
 * account map, keeps `direction: "transfer"` — never income — and is marked
 * `editable: false`. An unknown destination (archived/removed account) is
 * flagged through `transferAccountUnknown` with a null name, so the route
 * copy can show a marker instead of the raw id. Rows keep API order —
 * callers slice (never re-sort). */
export function toMovementRows(
  movements: MovementWire[] | null | undefined,
  accounts: NamedOption[],
  categories: NamedOption[],
  locale = "es-CO",
): MovementRowView[] {
  if (!movements) return [];
  const accountById = new Map(accounts.map((a) => [a.id, a.name]));
  const categoryById = new Map(categories.map((c) => [c.id, c.name]));
  return movements.map((m) => {
    const isTransfer = m.direction === "transfer";
    const destinationId = isTransfer ? (m.transfer_account_id ?? null) : null;
    const destinationName =
      destinationId == null ? null : (accountById.get(destinationId) ?? null);
    return {
      id: m.id,
      direction: m.direction,
      amount: toNumber(m.amount),
      occurredOn: m.occurred_on,
      displayDate: formatMovementDate(m.occurred_on, locale),
      description: m.description,
      accountName: accountById.get(m.account_id) ?? m.account_id,
      transferAccountName: destinationName,
      transferAccountUnknown: destinationId != null && destinationName == null,
      editable: m.direction === "expense" || m.direction === "income",
      categoryName: m.category_id == null ? null : (categoryById.get(m.category_id) ?? m.category_id),
    };
  });
}

export interface CategoryMovementTotals {
  expense: number;
  income: number;
}

/** Regla de una sola moneda, definida una vez para los cuatro agregados:
 * participa solo el movimiento cuya cuenta está en el mapa y cuya moneda
 * coincide con la del usuario. Una cuenta ausente del mapa (p. ej. archivada:
 * `/accounts` la oculta pero `/movements` todavía devuelve sus filas) se
 * excluye; nunca se asume la moneda del usuario ni se convierte. Las
 * transferencias obedecen la misma regla (sus dos patas comparten moneda por
 * construcción, D2.1): el guard no cambia. */
function isUserCurrencyMovement(
  movement: MovementWire,
  currencyByAccountId: Map<string, string>,
  userCurrency: string,
): boolean {
  return currencyByAccountId.get(movement.account_id) === userCurrency;
}

/** Per-category expense/income over movements, never netted. Rows without a
 * category are excluded (no "sin categoría" bucket); only rows whose account is
 * in the map and shares the user currency are counted (see
 * `isUserCurrencyMovement`): foreign-currency accounts and accounts missing
 * from the map are excluded, never converted or assumed. */
export function toCategoryMovementTotals(
  movements: MovementWire[] | null | undefined,
  currencyByAccountId: Map<string, string>,
  userCurrency: string,
  categoryId: string,
): CategoryMovementTotals {
  let expense = 0;
  let income = 0;
  for (const m of movements ?? []) {
    // D2.6 #1: only expense/income rows have a series; a transfer is neither.
    if (m.direction === "transfer") continue;
    if ((m.category_id ?? null) !== categoryId) continue;
    if (!isUserCurrencyMovement(m, currencyByAccountId, userCurrency)) continue;
    const amount = toNumber(m.amount);
    if (m.direction === "expense") expense += amount;
    else if (m.direction === "income") income += amount;
    // No default arm: an unknown direction never becomes income.
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

// -- W3: categoría en el tiempo (buckets puros, sin JSX, sin fetch) --

export type TrendPeriod = "day" | "week" | "month" | "year";

/** Pill order of the Día/Semana/Mes/Año selector. */
export const TREND_PERIODS: readonly TrendPeriod[] = ["day", "week", "month", "year"];

/** Fixed number of consecutive buckets rendered per period (owner-tunable). */
export const TREND_BUCKETS: Record<TrendPeriod, number> = {
  day: 14,
  week: 8,
  month: 12,
  year: 5,
};

export interface TrendBucket {
  /** Stable key: `2026-10-03` | `2026-W40` | `2026-10` | `2026`. */
  bucket: string;
  /** Short es-CO axis label: `3 oct` | `sem 28 sep` | `oct 26` | `2026`. */
  label: string;
  expense: number;
  income: number;
}

const SHORT_MONTH_ES = new Intl.DateTimeFormat("es-CO", {
  month: "short",
  timeZone: "UTC",
});

/** `oct.` → `oct` (ICU adds a trailing dot to es-CO short months). */
function monthShort(year: number, monthIndex: number): string {
  return SHORT_MONTH_ES.format(new Date(Date.UTC(year, monthIndex, 1))).replace(/\.$/, "");
}

function dayMonthLabel(d: Date): string {
  return `${d.getDate()} ${monthShort(d.getFullYear(), d.getMonth())}`;
}

function addLocalDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** First local calendar day of the unit containing `now` (Monday-first week). */
function trendUnitStart(period: TrendPeriod, now: Date): Date {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case "day":
      return day;
    case "week":
      return addLocalDays(day, -((day.getDay() + 6) % 7));
    case "month":
      return new Date(day.getFullYear(), day.getMonth(), 1);
    case "year":
      return new Date(day.getFullYear(), 0, 1);
  }
}

function shiftUnits(period: TrendPeriod, unitStart: Date, steps: number): Date {
  switch (period) {
    case "day":
      return addLocalDays(unitStart, -steps);
    case "week":
      return addLocalDays(unitStart, -steps * 7);
    case "month":
      return new Date(unitStart.getFullYear(), unitStart.getMonth() - steps, 1);
    case "year":
      return new Date(unitStart.getFullYear() - steps, 0, 1);
  }
}

/** ISO week key `YYYY-Www` for the Monday `unitStart` (week of its Thursday). */
function isoWeekKey(unitStart: Date): string {
  const thursday = addLocalDays(unitStart, 3);
  const isoYear = thursday.getFullYear();
  const jan4 = new Date(isoYear, 0, 4);
  const firstMonday = addLocalDays(jan4, -((jan4.getDay() + 6) % 7));
  const week = 1 + Math.round((thursday.getTime() - firstMonday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${isoYear}-W${pad2(week)}`;
}

function trendWindow(
  period: TrendPeriod,
  unitStart: Date,
): { key: string; label: string; from: string; to: string } {
  switch (period) {
    case "day": {
      const day = toISODateLocal(unitStart);
      return { key: day, label: dayMonthLabel(unitStart), from: day, to: day };
    }
    case "week":
      return {
        key: isoWeekKey(unitStart),
        label: `sem ${dayMonthLabel(unitStart)}`,
        from: toISODateLocal(unitStart),
        to: toISODateLocal(addLocalDays(unitStart, 6)),
      };
    case "month": {
      const year = unitStart.getFullYear();
      const month = unitStart.getMonth();
      return {
        key: `${year}-${pad2(month + 1)}`,
        label: `${monthShort(year, month)} ${String(year).slice(-2)}`,
        from: `${year}-${pad2(month + 1)}-01`,
        to: toISODateLocal(new Date(year, month + 1, 0)),
      };
    }
    case "year": {
      const year = unitStart.getFullYear();
      return { key: `${year}`, label: `${year}`, from: `${year}-01-01`, to: `${year}-12-31` };
    }
  }
}

/** N consecutive trend windows for `period`, oldest → newest; the last one is
 * the unit in progress at `now`. Boundaries are local `YYYY-MM-DD` strings, so
 * plain string comparison against `occurred_on` is exact (never `new
 * Date(wire)`: that parses as UTC midnight and shifts the day). */
export function trendBuckets(
  period: TrendPeriod,
  now: Date = new Date(),
  buckets?: number,
): { key: string; label: string; from: string; to: string }[] {
  const count = buckets ?? TREND_BUCKETS[period];
  const current = trendUnitStart(period, now);
  const windows: { key: string; label: string; from: string; to: string }[] = [];
  for (let steps = count - 1; steps >= 0; steps -= 1) {
    windows.push(trendWindow(period, shiftUnits(period, current, steps)));
  }
  return windows;
}

/** One category's movements split into the N period buckets. Applies the
 * single-currency rule of `toCategoryMovementTotals` (accounts missing from
 * the map are excluded, never converted), keeps expense and income separate
 * (never nets) and always returns every bucket, empty ones as 0/0 so the
 * trend has no gaps. */
export function toCategoryTrend(
  movements: MovementWire[] | undefined,
  opts: {
    categoryId: string;
    period: TrendPeriod;
    currencyByAccountId: Map<string, string>;
    userCurrency: string;
    now?: Date;
    buckets?: number;
  },
): TrendBucket[] {
  const windows = trendBuckets(opts.period, opts.now, opts.buckets);
  const totals = new Map<string, { expense: number; income: number }>(
    windows.map((w) => [w.key, { expense: 0, income: 0 }]),
  );
  for (const m of movements ?? []) {
    // D2.6 #2: a transfer never lands in the `ingreso` series (nor expense).
    if (m.direction === "transfer") continue;
    if ((m.category_id ?? null) !== opts.categoryId) continue;
    if (!isUserCurrencyMovement(m, opts.currencyByAccountId, opts.userCurrency)) continue;
    const window = windows.find((w) => w.from <= m.occurred_on && m.occurred_on <= w.to);
    if (!window) continue;
    const total = totals.get(window.key)!;
    const amount = toNumber(m.amount);
    if (m.direction === "expense") total.expense += amount;
    else if (m.direction === "income") total.income += amount;
    // No default arm: an unknown direction never becomes income.
  }
  return windows.map((w) => {
    const total = totals.get(w.key)!;
    return { bucket: w.key, label: w.label, expense: total.expense, income: total.income };
  });
}

/** Category-agnostic totals trend: every same-currency movement split into
 * the N period buckets, expense and income kept separate (never netted).
 * Movements whose account is missing from the map are excluded (never assumed
 * to be the user currency). Unlike `toCategoryTrend` there is no category
 * filter, so rows with a null `category_id` participate and no per-category
 * grouping is produced. */
export function toTotalTrend(
  movements: MovementWire[] | undefined,
  opts: {
    period: TrendPeriod;
    currencyByAccountId: Map<string, string>;
    userCurrency: string;
    now?: Date;
    buckets?: number;
  },
): TrendBucket[] {
  const windows = trendBuckets(opts.period, opts.now, opts.buckets);
  const totals = new Map<string, { expense: number; income: number }>(
    windows.map((w) => [w.key, { expense: 0, income: 0 }]),
  );
  for (const m of movements ?? []) {
    // D2.6 #3: a transfer-only period stays at 0/0, never inflates income.
    if (m.direction === "transfer") continue;
    if (!isUserCurrencyMovement(m, opts.currencyByAccountId, opts.userCurrency)) continue;
    const window = windows.find((w) => w.from <= m.occurred_on && m.occurred_on <= w.to);
    if (!window) continue;
    const total = totals.get(window.key)!;
    const amount = toNumber(m.amount);
    if (m.direction === "expense") total.expense += amount;
    else if (m.direction === "income") total.income += amount;
    // No default arm: an unknown direction never becomes income.
  }
  return windows.map((w) => {
    const total = totals.get(w.key)!;
    return { bucket: w.key, label: w.label, expense: total.expense, income: total.income };
  });
}

// -- W3: pastel de gasto por categoría del periodo actual (puro, sin fetch) --

export interface ExpenseCategorySlice {
  categoryId: string;
  name: string;
  value: number;
}

/** Rango del periodo actual por opción del pastel: día = hoy; semana = la
 * semana ISO en curso, lunes a domingo, la misma ventana que el bucket actual
 * del trend (decisión del owner: una sola «Semana» en la página); mes/año = la
 * unidad natural actual completa. Se arma con los helpers de fecha local del
 * archivo para que las fechas `occurred_on` nunca se corran por UTC. */
export function currentPeriodRange(
  period: TrendPeriod,
  now: Date = new Date(),
): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case "day":
      return { from: toISODateLocal(today), to: toISODateLocal(today) };
    case "week": {
      const from = addLocalDays(today, -((today.getDay() + 6) % 7));
      return { from: toISODateLocal(from), to: toISODateLocal(addLocalDays(from, 6)) };
    }
    case "month": {
      const year = today.getFullYear();
      const month = today.getMonth();
      return {
        from: `${year}-${pad2(month + 1)}-01`,
        to: toISODateLocal(new Date(year, month + 1, 0)),
      };
    }
    case "year": {
      const year = today.getFullYear();
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
  }
}

/** Gastos de `range` agrupados por categoría persistida, de mayor a menor.
 * Solo participan `direction === "expense"` con `category_id` no nulo que
 * exista en la lista `categories` respaldada por la API (los ids solo locales
 * quedan fuera); se excluyen ingresos y filas sin categoría. Aplica la regla
 * de una sola moneda de `toCategoryMovementTotals` (cuenta ausente del mapa →
 * excluida, nunca se asume su moneda ni se convierte), el rango es inclusivo
 * en ambos bordes y los totales en cero se descartan. */
export function toExpenseByCategory(
  movements: MovementWire[] | null | undefined,
  opts: {
    range: { from: string; to: string };
    categories: CategoryWire[] | null | undefined;
    currencyByAccountId: Map<string, string>;
    userCurrency: string;
  },
): ExpenseCategorySlice[] {
  const nameById = new Map((opts.categories ?? []).map((c) => [c.id, c.name]));
  const totals = new Map<string, number>();
  for (const m of movements ?? []) {
    // D2.6 #4: a transfer is never a slice; the expense gate below is kept
    // intentionally, so the exclusion is explicit rather than incidental.
    if (m.direction === "transfer") continue;
    if (m.direction !== "expense") continue;
    const categoryId = m.category_id ?? null;
    if (categoryId === null || !nameById.has(categoryId)) continue;
    if (!isUserCurrencyMovement(m, opts.currencyByAccountId, opts.userCurrency)) {
      continue;
    }
    if (m.occurred_on < opts.range.from || m.occurred_on > opts.range.to) continue;
    totals.set(categoryId, (totals.get(categoryId) ?? 0) + toNumber(m.amount));
  }
  return [...totals.entries()]
    .filter(([, value]) => value !== 0)
    .map(([categoryId, value]) => ({ categoryId, name: nameById.get(categoryId)!, value }))
    .sort((a, b) => b.value - a.value);
}
