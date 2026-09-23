import { describe, expect, it } from "vitest";
import {
  toAccountCards,
  toCategoryTotals,
  toDebtProgress,
  toDebtRows,
  toMonthlyPrice,
  toPeriodRange,
  toSavingsViews,
  toSubscriptionRows,
} from "./finance";

describe("finance transforms", () => {
  it("returns empty rows for nullish input", () => {
    expect(toAccountCards(null)).toEqual([]);
    expect(toSubscriptionRows(undefined)).toEqual([]);
    expect(toDebtRows(null)).toEqual([]);
    expect(toSavingsViews(undefined)).toEqual([]);
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

    const debts = toDebtRows([
      { id: "d1", name: "Loan", creditor: "Bank", original_amount: "500.00", pending_amount: "320.00", currency: "COP", status: "active", due_date: "2026-12-01" },
    ]);
    expect(debts[0].amount).toBe(320);
  });

  it("computes savings progress as a clamped fraction", () => {
    const goals = toSavingsViews([
      { id: "g1", name: "Trip", target_amount: "1000.00", saved_amount: "250.00", currency: "COP", is_completed: false, target_date: "2026-12-31" },
    ]);
    expect(goals[0].progress).toBe(0.25);
    expect(goals[0].completed).toBe(false);
  });
});

describe("toDebtProgress (S5 RED)", () => {
  it("computes paid/remaining/pct from original and pending", () => {
    expect(toDebtProgress({ original: 500, pending: 400 })).toEqual({
      paid: 100,
      remaining: 400,
      pct: 0.2,
      status: "ok",
    });
  });

  it("marks paid when pending<=0 and warns past 70% paid", () => {
    expect(toDebtProgress({ original: 500, pending: 0 }).status).toBe("paid");
    expect(toDebtProgress({ original: 500, pending: 100 }).status).toBe("warn");
    expect(toDebtProgress({ original: 500, pending: 500 }).pct).toBe(0);
  });
});

describe("toCategoryTotals (P7)", () => {
  const subs = [
    { id: "s1", name: "Music", price: "12000", currency: "COP", frequency: "monthly", next_billing_on: null, is_active: true, category_id: "c1" },
    { id: "s2", name: "Annual", price: "120000", currency: "COP", frequency: "annual", next_billing_on: null, is_active: true, category_id: "c1" },
    { id: "s3", name: "Other", price: "5000", currency: "COP", frequency: "monthly", next_billing_on: null, is_active: true, category_id: "c2" },
    { id: "s4", name: "Off", price: "9999", currency: "COP", frequency: "monthly", next_billing_on: null, is_active: false, category_id: "c1" },
  ];
  const goals = [
    { id: "g1", name: "Trip", target_amount: "100000", saved_amount: "25000", currency: "COP", is_completed: false, target_date: null, category_id: "c1" },
    { id: "g2", name: "NoCat", target_amount: "100", saved_amount: "50", currency: "COP", is_completed: false, target_date: null },
  ];
  it("sums monthly-equivalent spend plus saved amounts for one category", () => {
    expect(toCategoryTotals(subs, goals, "c1")).toEqual({ expenses: 22000, savings: 25000 });
  });
  it("ignores other categories, inactive subs and uncategorized goals", () => {
    expect(toCategoryTotals(subs, goals, "c2")).toEqual({ expenses: 5000, savings: 0 });
    expect(toCategoryTotals(subs, goals, "missing")).toEqual({ expenses: 0, savings: 0 });
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
