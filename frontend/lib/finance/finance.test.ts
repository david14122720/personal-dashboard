import { describe, expect, it } from "vitest";
import {
  toAccountCards,
  toMonthlyPrice,
  toPeriodRange,
  toSubscriptionRows,
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
