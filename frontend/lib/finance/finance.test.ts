import { describe, expect, it } from "vitest";
import { buildTransactionsPath, transactionsPageKey } from "@/lib/api/finance";
import {
  ledgerKey,
  toAccountCards,
  toBalanceSeries,
  toBudgetViews,
  toDebtProgress,
  toDebtRows,
  toExpenseSeries,
  toInsights,
  toLedgerRows,
  toMonthCompare,
  toMonthOverMonth,
  toPeriodRange,
  toSavingsSeries,
  toSavingsViews,
  toSubscriptionRows,
} from "./finance";

describe("finance transforms", () => {
  it("coerces ledger amounts from decimal strings to numbers", () => {
    const rows = toLedgerRows([
      {
        id: "t1",
        account_id: "a1",
        type: "expense",
        amount: "50.00",
        currency: "COP",
        occurred_on: "2026-09-01",
        category_id: null,
        description: "groceries",
        notes: null,
        credit_card_account_id: null,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(50);
    expect(rows[0].description).toBe("groceries");
  });

  it("falls back to an em dash for missing descriptions", () => {
    const rows = toLedgerRows([
      {
        id: "t1",
        account_id: "a1",
        type: "income",
        amount: "100.00",
        currency: "COP",
        occurred_on: "2026-09-01",
        category_id: null,
        description: null,
        notes: null,
        credit_card_account_id: null,
      },
    ]);
    expect(rows[0].description).toBe("—");
  });

  it("returns empty rows for nullish input", () => {
    expect(toLedgerRows(null)).toEqual([]);
    expect(toBudgetViews(undefined)).toEqual([]);
    expect(toAccountCards(null)).toEqual([]);
    expect(toSubscriptionRows(undefined)).toEqual([]);
    expect(toDebtRows(null)).toEqual([]);
    expect(toSavingsViews(undefined)).toEqual([]);
  });

  it("clamps budget pct to [0, 1] for progress bars", () => {
    const views = toBudgetViews([
      {
        id: "b1",
        category_id: "c1",
        amount: "100.00",
        currency: "COP",
        period_start: "2026-09-01",
        spent: "120.00",
        remaining: "-20.00",
        pct: 1.2,
        status: "over",
      },
    ]);
    expect(views[0].pct).toBe(1);
    expect(views[0].spent).toBe(120);
    expect(views[0].remaining).toBe(-20);
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

  it("keeps active subscriptions and debt pending amounts", () => {
    const subs = toSubscriptionRows([
      { id: "s1", name: "Music", price: "9.99", currency: "USD", frequency: "monthly", next_billing_on: "2026-10-01", is_active: true },
      { id: "s2", name: "Old", price: "5.00", currency: "USD", frequency: "monthly", next_billing_on: null, is_active: false },
    ]);
    expect(subs.map((s) => s.id)).toEqual(["s1"]);

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

  it("serializes ledger filters and keeps the cursor opaque", () => {
    const path = buildTransactionsPath({ type: "expense", from: "2026-09-01" }, "b3BhcXVlLW9wYXF1ZQ");
    expect(path).toContain("type=expense");
    expect(path).toContain("from=2026-09-01");
    expect(path).toContain("cursor=b3BhcXVlLW9wYXF1ZQ");
    expect(buildTransactionsPath({}, null)).toBe("/transactions");
  });

  it("produces distinct SWR keys per cursor and filter set", () => {
    expect(transactionsPageKey({}, null)).not.toBe(transactionsPageKey({}, "abc"));
    expect(ledgerKey({ type: "income" })).not.toBe(ledgerKey({ type: "expense" }));
    expect(ledgerKey({})).toBe(ledgerKey({}));
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

// -- PR-3 S6 puros (RED: toPeriodRange + series + MoM + insights) --
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

describe("toMonthOverMonth + series (PR-3 RED)", () => {
  it("computes delta and pct, null when prev==0", () => {
    expect(toMonthOverMonth(500, 400)).toEqual({ delta: 100, pct: 0.25 });
    expect(toMonthOverMonth(100, 0).pct).toBeNull();
  });
  it("builds savings series income-expense with string coercion", () => {
    expect(
      toSavingsSeries([
        { month: "2026-08", income: "1000.00", expense: "400.00" },
        { month: "2026-09", income: 1200, expense: 500 },
      ]),
    ).toEqual([
      { month: "2026-08", savings: 600 },
      { month: "2026-09", savings: 700 },
    ]);
  });
  it("builds accumulated balance series in chronological order", () => {
    expect(
      toBalanceSeries([
        { month: "2026-08", income: "1000.00", expense: "400.00" },
        { month: "2026-09", income: "1200.00", expense: "500.00" },
      ]),
    ).toEqual([
      { month: "2026-08", balance: 600 },
      { month: "2026-09", balance: 1300 },
    ]);
  });
  it("compares last two months or null when <2", () => {
    expect(
      toMonthCompare([
        { month: "2026-08", income: "900.00", expense: "400.00" },
        { month: "2026-09", income: "1200.00", expense: "500.00" },
      ])?.deltaPct,
    ).toBeCloseTo(0.25, 5);
    expect(toMonthCompare([{ month: "2026-09", income: "1000.00", expense: "400.00" }])).toBeNull();
  });
});

describe("toInsights (PR-3 RED)", () => {
  const flow = [
    { month: "2026-07", income: "2000.00", expense: "800.00" },
    { month: "2026-08", income: "2000.00", expense: "1000.00" },
    { month: "2026-09", income: "2000.00", expense: "1200.00" },
  ];
  const byCatExpense = [{ name: "Mercado", total: "1500.00" }];
  const byCatIncome = [{ name: "Salario", total: "6000.00" }];
  const budgets = [
    { id: "b1", label: "Mercado", spent: 90, amount: 100, pct: 0.9, status: "warn" },
  ];
  it("returns 3..6 ordered insights with interpolated values", () => {
    const insights = toInsights({ flow, byCatExpense, byCatIncome, budgets });
    expect(insights.length).toBeGreaterThanOrEqual(3);
    expect(insights.length).toBeLessThanOrEqual(6);
    expect(insights.map((i) => i.kind)).toContain("savings-rate");
  });
  it("omits recurrent line when descriptions are inconclusive", () => {
    const withoutRecurrent = toInsights({
      flow,
      byCatExpense,
      byCatIncome,
      budgets,
      descriptions: ["a", "b", "c"],
    });
    expect(withoutRecurrent.map((i) => i.kind)).not.toContain("recurrent");
    const withRecurrent = toInsights({
      flow,
      byCatExpense,
      byCatIncome,
      budgets,
      descriptions: ["Arriendo", "Arriendo", "Arriendo", "Café"],
    });
    expect(withRecurrent.map((i) => i.kind)).toContain("recurrent");
  });
});

// -- PR-3 TRIANGULATE (bordes: vacíos, negativos, orden, prev==0, custom inválido) --
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
  it("toMonthOverMonth triangula negativo y cero", () => {
    expect(toMonthOverMonth(300, 500)).toEqual({ delta: -200, pct: -0.4 });
    expect(toMonthOverMonth(0, 0)).toEqual({ delta: 0, pct: null });
  });
  it("series toleran vacío, negativo y desorden", () => {
    expect(toSavingsSeries([])).toEqual([]);
    expect(toSavingsSeries(null)).toEqual([]);
    expect(toSavingsSeries([{ month: "2026-09", income: "400.00", expense: "900.00" }])).toEqual([
      { month: "2026-09", savings: -500 },
    ]);
    expect(
      toBalanceSeries([
        { month: "2026-09", income: "1200.00", expense: "500.00" },
        { month: "2026-08", income: "1000.00", expense: "400.00" },
      ]),
    ).toEqual([
      { month: "2026-08", balance: 600 },
      { month: "2026-09", balance: 1300 },
    ]);
    expect(toBalanceSeries([])).toEqual([]);
  });
  it("toMonthCompare triangula vacío y prev==0", () => {
    expect(toMonthCompare([])).toBeNull();
    expect(toMonthCompare(null)).toBeNull();
    const zeroPrev = toMonthCompare([
      { month: "2026-08", income: "0.00", expense: "0.00" },
      { month: "2026-09", income: "100.00", expense: "500.00" },
    ]);
    expect(zeroPrev?.deltaPct).toBeNull();
    expect(zeroPrev?.cur).toBe(500);
    expect(zeroPrev?.prev).toBe(0);
  });
  it("toInsights triangula vacío, 1 mes sin MoM y tope 6", () => {
    expect(toInsights({ flow: [], byCatExpense: [], byCatIncome: [] })).toEqual([]);
    const single = toInsights({
      flow: [{ month: "2026-09", income: "2000.00", expense: "800.00" }],
      byCatExpense: [{ name: "Mercado", total: "800.00" }],
      byCatIncome: [],
      budgets: [],
    });
    expect(single.map((i) => i.kind)).not.toContain("mom-expense");
    expect(single.length).toBeGreaterThanOrEqual(3);
    const many = toInsights({
      flow: [
        { month: "2026-07", income: "2000.00", expense: "800.00" },
        { month: "2026-08", income: "2000.00", expense: "1000.00" },
        { month: "2026-09", income: "2000.00", expense: "1200.00" },
      ],
      byCatExpense: [{ name: "Mercado", total: "1500.00" }],
      byCatIncome: [{ name: "Salario", total: "6000.00" }],
      budgets: [{ id: "b1", label: "Mercado", spent: 120, amount: 100, pct: 1.2, status: "over" }],
      descriptions: ["Arriendo", "Arriendo", "Arriendo"],
    });
    expect(many.length).toBeLessThanOrEqual(6);
    expect(many.map((i) => i.kind)).toContain("recurrent");
  });
  it("toExpenseSeries coerciona columna expense con strings", () => {
    expect(
      toExpenseSeries([
        { month: "2026-08", income: "1000.00", expense: "300.00" },
        { month: "2026-09", income: 1200, expense: 500 },
      ]),
    ).toEqual([
      { month: "2026-08", expense: 300 },
      { month: "2026-09", expense: 500 },
    ]);
    expect(toExpenseSeries([])).toEqual([]);
  });
});
