import { describe, expect, it } from "vitest";
import {
  normalizeManualAmount,
  toAccountCards,
  toCategoryTrend,
  toMonthlyPrice,
  toPeriodRange,
  toSubscriptionRows,
  todayInBogota,
  TREND_BUCKETS,
  TREND_PERIODS,
  trendBuckets,
} from "./finance";
import type { MovementWire } from "@/lib/api/finance";

describe("finance transforms", () => {
  it("returns empty rows for nullish input", () => {
    expect(toAccountCards(null)).toEqual([]);
    expect(toSubscriptionRows(undefined)).toEqual([]);
  });

  it("coerces account card usage metrics and keeps statement balance", () => {
    const cards = toAccountCards([
      {
        id: "a1",
        name: "Visa",
        type: "credit_card",
        currency: "COP",
        balance: "-500.00",
        alert_level: "warn",
        used_balance: "500.00",
        available_balance: "1500.00",
        usage_pct: "25.00",
        statement_balance: "320.50",
      },
    ]);
    expect(cards[0].isCard).toBe(true);
    expect(cards[0].used).toBe(500);
    expect(cards[0].usagePct).toBe(25);
    expect(cards[0].statementBalance).toBe(320.5);
  });

  it("marks plain accounts as non-card with null usage", () => {
    const cards = toAccountCards([
      {
        id: "a2",
        name: "Wallet",
        type: "cash",
        currency: "COP",
        balance: "200.00",
      },
    ]);
    expect(cards[0].isCard).toBe(false);
    expect(cards[0].used).toBeNull();
    expect(cards[0].alertLevel).toBeNull();
  });

  it("keeps active subscriptions with monthly price and next billing date only", () => {
    const subs = toSubscriptionRows([
      { id: "s1", name: "Music", price: "9.99", currency: "USD", frequency: "monthly", next_billing_on: "2026-10-01", is_active: true },
      { id: "s2", name: "Old", price: "5.00", currency: "USD", frequency: "monthly", next_billing_on: null, is_active: false },
      { id: "s3", name: "Annual", price: "120.00", currency: "USD", frequency: "annual", next_billing_on: "2026-12-01", is_active: true },
    ]);
    expect(subs.map((s) => s.id)).toEqual(["s1", "s3"]);
    expect(subs[0].detail).toBe("2026-10-01");
    expect(subs[0].amount).toBeCloseTo(9.99, 6);
    expect(subs[1].amount).toBeCloseTo(10, 6);
  });

  it("converts unknown frequencies at face value", () => {
    expect(toMonthlyPrice("100", "mystery")).toBe(100);
    expect(toMonthlyPrice("120", "annual")).toBe(10);
  });
});

// -- PR-3 S6 puros: toPeriodRange survives for the reports PeriodSelector --
describe("toPeriodRange (PR-3 RED)", () => {
  const now = new Date(2026, 8, 9, 12, 0, 0); // 2026-09-09 local
  it("defaults month to the current natural month", () => {
    expect(toPeriodRange({ kind: "month" }, now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("computes week as hoy-6..hoy and custom validates from<=to", () => {
    expect(toPeriodRange({ kind: "week" }, now)).toEqual({ from: "2026-09-03", to: "2026-09-09" });
    expect(toPeriodRange({ kind: "custom", from: "2026-07-01", to: "2026-09-09" }, now)).toEqual({
      from: "2026-07-01",
      to: "2026-09-09",
    });
    expect(() => toPeriodRange({ kind: "custom", from: "2026-09-10", to: "2026-09-01" }, now)).toThrow();
  });
  it("computes natural quarter and year ranges", () => {
    expect(toPeriodRange({ kind: "quarter" }, now)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(toPeriodRange({ kind: "year" }, now)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

// -- S1: manual amount normalizer (F1, 100x corruption) --
describe("normalizeManualAmount (formatos COP/US)", () => {
  it("normaliza miles con punto y decimales con coma (COP)", () => {
    expect(normalizeManualAmount("3.500.000")).toBe("3500000");
    expect(normalizeManualAmount("25.000")).toBe("25000");
    expect(normalizeManualAmount("1.000")).toBe("1000");
    expect(normalizeManualAmount("1.500.000,50")).toBe("1500000.50");
    expect(normalizeManualAmount("1.234,56")).toBe("1234.56");
  });

  it("normaliza miles con coma y decimales con punto (US)", () => {
    expect(normalizeManualAmount("25,000")).toBe("25000");
    expect(normalizeManualAmount("1,500")).toBe("1500");
    expect(normalizeManualAmount("1,500,000.50")).toBe("1500000.50");
  });

  it("acepta coma decimal sola y punto decimal solo", () => {
    expect(normalizeManualAmount("25,50")).toBe("25.50");
    expect(normalizeManualAmount("0,01")).toBe("0.01");
    expect(normalizeManualAmount("25.50")).toBe("25.50");
  });

  it("ignora espacios de miles tecleados a mano", () => {
    expect(normalizeManualAmount("1 000 000")).toBe("1000000");
  });

  it("rechaza formas ambiguas o no positivas", () => {
    expect(normalizeManualAmount(null)).toBeNull();
    expect(normalizeManualAmount("")).toBeNull();
    expect(normalizeManualAmount("abc")).toBeNull();
    expect(normalizeManualAmount("0")).toBeNull();
    expect(normalizeManualAmount("-5")).toBeNull();
    expect(normalizeManualAmount("1.2.3")).toBeNull();
    expect(normalizeManualAmount("1.000.00")).toBeNull();
    expect(normalizeManualAmount("1.2345")).toBeNull();
  });

  it("rechaza un cero inicial en el agrupado de miles", () => {
    // A leading zero cannot start a thousands grouping in COP.
    expect(normalizeManualAmount("0.500")).toBeNull();
    expect(normalizeManualAmount("0.001")).toBeNull();
    expect(normalizeManualAmount("0,500")).toBeNull();
    expect(normalizeManualAmount("0.501")).toBeNull();
  });
});

// -- todayInBogota: exact UTC midnight boundary (probe f7 fold) --
describe("todayInBogota (borde UTC medianoche)", () => {
  it("permanece en la fecha local de Bogotá alrededor de la medianoche UTC", () => {
    expect(todayInBogota(new Date("2026-09-24T02:00:00Z"))).toBe("2026-09-23");
    expect(todayInBogota(new Date("2026-09-24T04:59:59Z"))).toBe("2026-09-23");
    expect(todayInBogota(new Date("2026-09-24T05:00:00Z"))).toBe("2026-09-24");
    expect(todayInBogota(new Date("2026-09-24T23:59:59Z"))).toBe("2026-09-24");
  });
});

// -- PR-3 TRIANGULATE (bordes: custom inválido, february bisiesto) --
describe("puros PR-3 triangulate", () => {
  it("toPeriodRange rechaza custom inválido y february bisiesto", () => {
    const now = new Date(2024, 1, 15, 12, 0, 0); // 2024-02-15 bisiesto
    expect(toPeriodRange({ kind: "month" }, now)).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(() => toPeriodRange({ kind: "custom", from: "2026-13-01", to: "2026-09-01" }, now)).toThrow();
    expect(() => toPeriodRange({ kind: "custom" }, now)).toThrow();
    expect(toPeriodRange({ kind: "quarter" }, new Date(2026, 0, 10))).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
  });
});

// -- W3: tendencia por categoría (buckets puros, sin reloj real) --
describe("trendBuckets", () => {
  const now = new Date(2026, 9, 3, 12, 0, 0); // sábado 3 de octubre de 2026

  it("expone el orden de periodos y el N fijo por periodo (14/8/12/5)", () => {
    expect(TREND_PERIODS).toEqual(["day", "week", "month", "year"]);
    expect(TREND_BUCKETS).toEqual({ day: 14, week: 8, month: 12, year: 5 });
    expect(trendBuckets("day", now)).toHaveLength(14);
    expect(trendBuckets("week", now)).toHaveLength(8);
    expect(trendBuckets("month", now)).toHaveLength(12);
    expect(trendBuckets("year", now)).toHaveLength(5);
  });

  it("emite de más viejo a más nuevo y el último bucket es la unidad en curso", () => {
    const days = trendBuckets("day", now);
    expect(days[0]).toMatchObject({ key: "2026-09-20", from: "2026-09-20", to: "2026-09-20" });
    expect(days[13]).toMatchObject({ key: "2026-10-03", from: "2026-10-03", to: "2026-10-03" });
    expect(days[13].label).toBe("3 oct");

    const weeks = trendBuckets("week", now);
    expect(weeks[0]).toMatchObject({ from: "2026-08-10", to: "2026-08-16" });
    expect(weeks[7]).toMatchObject({ key: "2026-W40", from: "2026-09-28", to: "2026-10-04" });
    expect(weeks[7].label).toMatch(/^sem 28 se/);

    const months = trendBuckets("month", now);
    expect(months[0]).toMatchObject({ key: "2025-11", from: "2025-11-01", to: "2025-11-30" });
    expect(months[11]).toMatchObject({ key: "2026-10", from: "2026-10-01", to: "2026-10-31" });
    expect(months[11].label).toBe("oct 26");

    const years = trendBuckets("year", now);
    expect(years[0]).toMatchObject({ key: "2022", from: "2022-01-01", to: "2022-12-31" });
    expect(years[4]).toMatchObject({ key: "2026", from: "2026-01-01", to: "2026-12-31" });
    expect(years[4].label).toBe("2026");
  });

  it("respeta el override de buckets", () => {
    expect(trendBuckets("day", now, 3).map((b) => b.key)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
  });

  it("usa semanas que arrancan en lunes (el domingo cierra su lunes)", () => {
    const weeks = trendBuckets("week", now);
    expect(weeks[6].to).toBe("2026-09-27");
    expect(weeks[7].from).toBe("2026-09-28");
  });
});

function trendMovement(overrides: Partial<MovementWire> = {}): MovementWire {
  return {
    id: "m1",
    direction: "expense",
    amount: "100.00",
    occurred_on: "2026-10-03",
    description: null,
    account_id: "a1",
    category_id: "c1",
    subscription_id: null,
    created_at: "2026-10-03T10:00:00Z",
    updated_at: "2026-10-03T10:00:00Z",
    ...overrides,
  };
}

const TREND_ACCOUNTS = new Map([
  ["a1", "COP"],
  ["usd1", "USD"],
]);

const TREND_BASE = {
  categoryId: "c1",
  currencyByAccountId: TREND_ACCOUNTS,
  userCurrency: "COP",
} as const;

describe("toCategoryTrend", () => {
  const now = new Date(2026, 9, 3, 12, 0, 0); // sábado 3 de octubre de 2026

  it("devuelve siempre N buckets y deja los vacíos en 0/0", () => {
    const buckets = toCategoryTrend([trendMovement()], { ...TREND_BASE, period: "day", now });
    expect(buckets).toHaveLength(14);
    expect(buckets[13]).toMatchObject({ bucket: "2026-10-03", expense: 100, income: 0 });
    expect(buckets.slice(0, 13).every((b) => b.expense === 0 && b.income === 0)).toBe(true);
  });

  it("acumula gasto e ingreso por separado en el mismo bucket (nunca netea)", () => {
    const buckets = toCategoryTrend(
      [
        trendMovement({ id: "e1", direction: "expense", amount: "25000.00" }),
        trendMovement({ id: "i1", direction: "income", amount: "40000.00" }),
      ],
      { ...TREND_BASE, period: "day", now },
    );
    expect(buckets[13]).toMatchObject({ expense: 25000, income: 40000 });
    expect(Object.keys(buckets[13]).sort()).toEqual(["bucket", "expense", "income", "label"]);
  });

  it("excluye movimientos de cuentas en otra moneda (sin convertir)", () => {
    const buckets = toCategoryTrend([trendMovement({ account_id: "usd1", amount: "999.00" })], {
      ...TREND_BASE,
      period: "day",
      now,
    });
    expect(buckets.every((b) => b.expense === 0 && b.income === 0)).toBe(true);
  });

  it("excluye otras categorías, sin categoría y movimientos fuera de rango", () => {
    const buckets = toCategoryTrend(
      [
        trendMovement({ id: "x", category_id: "c2", amount: "555.00" }),
        trendMovement({ id: "z", category_id: null, amount: "666.00" }),
        trendMovement({ id: "y", occurred_on: "2026-09-19", amount: "777.00" }),
      ],
      { ...TREND_BASE, period: "day", now },
    );
    expect(buckets.every((b) => b.expense === 0 && b.income === 0)).toBe(true);
  });

  it("incluye los bordes from/to exactos y excluye el día anterior", () => {
    const buckets = toCategoryTrend(
      [
        trendMovement({ id: "b1", occurred_on: "2026-09-20", amount: "10.00" }),
        trendMovement({ id: "b2", occurred_on: "2026-10-03", amount: "20.00" }),
        trendMovement({ id: "b3", occurred_on: "2026-09-19", amount: "30.00" }),
      ],
      { ...TREND_BASE, period: "day", now },
    );
    expect(buckets[0].expense).toBe(10);
    expect(buckets[13].expense).toBe(20);
    expect(buckets.reduce((sum, b) => sum + b.expense, 0)).toBe(30);
  });

  it("asigna la semana por lunes (el domingo cae en la semana de su lunes)", () => {
    const buckets = toCategoryTrend(
      [
        trendMovement({ id: "w1", occurred_on: "2026-10-04", amount: "40.00" }),
        trendMovement({ id: "w2", occurred_on: "2026-09-27", amount: "60.00" }),
      ],
      { ...TREND_BASE, period: "week", now },
    );
    expect(buckets[7].expense).toBe(40);
    expect(buckets[6].expense).toBe(60);
  });

  it("no desplaza el día por parsear la fecha como UTC (primero del mes)", () => {
    const buckets = toCategoryTrend(
      [trendMovement({ occurred_on: "2026-10-01", amount: "500.00" })],
      { ...TREND_BASE, period: "month", now },
    );
    expect(buckets[11]).toMatchObject({ bucket: "2026-10", expense: 500 });
    expect(buckets[10].expense).toBe(0);
  });

  it("tolera payload indefinido o vacío y mantiene los N buckets en cero", () => {
    const years = toCategoryTrend(undefined, { ...TREND_BASE, period: "year", now });
    expect(years).toHaveLength(5);
    expect(years.every((b) => b.expense === 0 && b.income === 0)).toBe(true);

    const weeks = toCategoryTrend([], { ...TREND_BASE, period: "week", now, buckets: 2 });
    expect(weeks.map((b) => b.bucket)).toEqual(["2026-W39", "2026-W40"]);
  });
});
