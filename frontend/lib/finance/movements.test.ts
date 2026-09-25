import { describe, expect, it } from "vitest";
import type { MovementWire } from "@/lib/api/finance";
import {
  formatMovementDate,
  isPaidThisCycle,
  toCategoryMovementTotals,
  toMovementRows,
  toTotalBalance,
  todayInBogota,
  type AccountCardView,
} from "./finance";

function movement(overrides: Partial<MovementWire> & { id: string }): MovementWire {
  return {
    direction: "expense",
    amount: "100.00",
    occurred_on: "2026-09-24",
    description: null,
    account_id: "a1",
    category_id: "c1",
    subscription_id: null,
    created_at: "2026-09-24T10:00:00Z",
    updated_at: "2026-09-24T10:00:00Z",
    ...overrides,
  };
}

const accounts = [
  { id: "a1", name: "Cuenta principal" },
  { id: "a2", name: "Bolsillo USD" },
];
const categories = [
  { id: "c1", name: "Mercado" },
  { id: "c2", name: "Sueldo" },
];

function card(overrides: Partial<AccountCardView> & { id: string }): AccountCardView {
  return {
    name: overrides.id,
    type: "bank",
    currency: "COP",
    balance: 0,
    isCard: false,
    used: null,
    available: null,
    usagePct: null,
    alertLevel: null,
    statementBalance: null,
    ...overrides,
  };
}

describe("toMovementRows", () => {
  it("returns [] for nullish input", () => {
    expect(toMovementRows(null, accounts, categories)).toEqual([]);
    expect(toMovementRows(undefined, accounts, categories)).toEqual([]);
  });

  it("resolves names, coerces decimal-string amounts and keeps API order", () => {
    const rows = toMovementRows(
      [
        movement({ id: "m1", direction: "expense", amount: "25000.00", description: "mercado" }),
        movement({ id: "m2", direction: "income", amount: "110000.00", category_id: "c2", account_id: "a2" }),
      ],
      accounts,
      categories,
    );
    expect(rows.map((r) => r.id)).toEqual(["m1", "m2"]);
    expect(rows[0]).toMatchObject({
      direction: "expense",
      amount: 25000,
      occurredOn: "2026-09-24",
      description: "mercado",
      accountName: "Cuenta principal",
      categoryName: "Mercado",
    });
    expect(rows[1].accountName).toBe("Bolsillo USD");
    expect(rows[1].categoryName).toBe("Sueldo");
  });

  it("keeps null categories null and falls back to raw ids when unknown", () => {
    const rows = toMovementRows(
      [movement({ id: "m9", category_id: null, account_id: "ghost" })],
      accounts,
      categories,
    );
    expect(rows[0].categoryName).toBeNull();
    expect(rows[0].accountName).toBe("ghost");
  });
});

describe("formatMovementDate", () => {
  it("renders a Spanish date and passes garbage through", () => {
    const rendered = formatMovementDate("2026-09-24");
    expect(rendered).toContain("2026");
    expect(rendered).not.toBe("2026-09-24");
    expect(formatMovementDate("24/09/2026")).toBe("24/09/2026");
  });
});

describe("toCategoryMovementTotals", () => {
  const byAccount = new Map([
    ["a1", "COP"],
    ["a2", "USD"],
  ]);
  const wires: MovementWire[] = [
    movement({ id: "m1", direction: "expense", amount: "100.00", category_id: "c1", account_id: "a1" }),
    movement({ id: "m2", direction: "income", amount: "50.00", category_id: "c1", account_id: "a1" }),
    movement({ id: "m3", direction: "expense", amount: "999.00", category_id: "c1", account_id: "a2" }),
    movement({ id: "m4", direction: "expense", amount: "7.00", category_id: null, account_id: "a1" }),
    movement({ id: "m5", direction: "expense", amount: "11.00", category_id: "c2", account_id: "a1" }),
  ];

  it("reports gasto and ingreso as separate series, never netted", () => {
    expect(toCategoryMovementTotals(wires, byAccount, "COP", "c1")).toEqual({
      expense: 100,
      income: 50,
    });
  });

  it("excludes foreign-currency rows without converting them", () => {
    const totals = toCategoryMovementTotals(wires, byAccount, "COP", "c1");
    expect(totals.expense).toBe(100);
  });

  it("excludes null-category rows and other categories", () => {
    expect(toCategoryMovementTotals(wires, byAccount, "COP", "c2")).toEqual({
      expense: 11,
      income: 0,
    });
  });

  it("returns zeros for nullish input", () => {
    expect(toCategoryMovementTotals(null, byAccount, "COP", "c1")).toEqual({
      expense: 0,
      income: 0,
    });
  });
});

describe("toTotalBalance", () => {
  it("sums same-currency balances only", () => {
    const total = toTotalBalance(
      [
        card({ id: "a1", currency: "COP", balance: 100000 }),
        card({ id: "a2", currency: "COP", balance: -500 }),
        card({ id: "a3", currency: "USD", balance: 99999 }),
      ],
      "COP",
    );
    expect(total).toBe(99500);
  });

  it("returns 0 for nullish input", () => {
    expect(toTotalBalance(null, "COP")).toBe(0);
  });
});

describe("todayInBogota", () => {
  it("formats YYYY-MM-DD in America/Bogota, not UTC", () => {
    // 02:00 UTC is still the previous day in Bogota (UTC-5).
    expect(todayInBogota(new Date("2026-09-24T02:00:00Z"))).toBe("2026-09-23");
    expect(todayInBogota(new Date("2026-09-24T06:00:00Z"))).toBe("2026-09-24");
  });

  it("matches the YYYY-MM-DD shape", () => {
    expect(todayInBogota()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("isPaidThisCycle", () => {
  const today = "2026-09-24";

  it("is true when stamped and the due date is still ahead", () => {
    expect(
      isPaidThisCycle({ last_paid_on: "2026-09-24", next_billing_on: "2026-10-15" }, today),
    ).toBe(true);
  });

  it("is false without a stamp, without a due date, or once due arrives", () => {
    expect(
      isPaidThisCycle({ last_paid_on: null, next_billing_on: "2026-10-15" }, today),
    ).toBe(false);
    expect(
      isPaidThisCycle({ last_paid_on: "2026-09-24", next_billing_on: null }, today),
    ).toBe(false);
    expect(
      isPaidThisCycle({ last_paid_on: "2026-08-24", next_billing_on: "2026-09-24" }, today),
    ).toBe(false);
  });
});
