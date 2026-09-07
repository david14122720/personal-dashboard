import { describe, expect, it } from "vitest";
import { buildTransactionsPath, transactionsPageKey } from "@/lib/api/finance";
import {
  ledgerKey,
  toAccountCards,
  toBudgetViews,
  toDebtRows,
  toLedgerRows,
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
