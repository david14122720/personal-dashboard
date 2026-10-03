import { describe, expect, it } from "vitest";
import {
  normalizeManualAmount,
  toAccountCards,
  toMonthlyPrice,
  toPeriodRange,
  toSubscriptionRows,
  todayInBogota,
} from "./finance";

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
