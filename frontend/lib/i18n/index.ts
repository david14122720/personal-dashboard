import { es } from "./es";

export type Paths<T, P extends string = ""> = T extends string
  ? P
  : { [K in keyof T]: Paths<T[K], `${P}${P extends "" ? "" : "."}${K & string}`> }[keyof T];

export type EsKey = Paths<typeof es>;

function lookup(key: EsKey): string {
  let node: unknown = es;
  for (const part of key.split(".")) {
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== "string") throw new Error(`Unknown i18n key: ${key}`);
  return node;
}

export function t(key: EsKey, vars?: Record<string, string | number>): string {
  const template = lookup(key);
  if (!vars) return template;
  return Object.entries(vars).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

export function chartToken(prop: `--color-${string}`): string {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof getComputedStyle === "undefined"
  ) {
    return "";
  }
  const computed = getComputedStyle(document.documentElement)
    .getPropertyValue(prop)
    .trim();
  if (computed) return computed;
  return document.documentElement.style.getPropertyValue(prop).trim();
}

export function formatMonth(monthKey: string, locale = "es-CO"): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return monthKey;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return monthKey;
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
