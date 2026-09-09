/**
 * Money boundary: the backend sends decimal amounts as strings
 * (e.g. "123.45"). This module is the SOLE place that coerces them
 * to numbers for rendering. UI components receive numbers only.
 */

export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface MoneyFormatOptions {
  locale?: string;
  currency?: string;
}

/**
 * Locale-aware currency formatting. Defaults match the primary user
 * (es-CO / COP) but callers SHOULD pass the user's preferences.
 */
export function formatMoney(
  value: string | number | null | undefined,
  { locale = "es-CO", currency = "COP" }: MoneyFormatOptions = {},
): string {
  const amount = toNumber(value);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "COP" ? 0 : 2,
    }).format(amount);
  } catch {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    }).format(amount);
  }
}
