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

function account(overrides: Partial<AccountCardView> & { id: string }): AccountCardView {
  return {
    name: overrides.id,
    currency: "COP",
    balance: 0,
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

// -- W2 D2.6 #5: la fila de transferencia resuelve origen y destino --
describe("toMovementRows: transferencias", () => {
  it("resuelve origen y destino y nunca devuelve un ingreso", () => {
    const rows = toMovementRows(
      [
        movement({
          id: "t1",
          direction: "transfer",
          amount: "25000.00",
          account_id: "a1",
          category_id: null,
          transfer_account_id: "a2",
        }),
      ],
      accounts,
      categories,
    );
    expect(rows[0]).toMatchObject({
      direction: "transfer",
      amount: 25000,
      accountName: "Cuenta principal",
      transferAccountName: "Bolsillo USD",
      transferAccountUnknown: false,
      categoryName: null,
    });
    expect(rows[0].direction).not.toBe("income");
  });

  it("marca un destino ausente del mapa sin exponer su id crudo", () => {
    const rows = toMovementRows(
      [
        movement({
          id: "t2",
          direction: "transfer",
          category_id: null,
          account_id: "a1",
          transfer_account_id: "cuenta-archivada",
        }),
      ],
      accounts,
      categories,
    );
    expect(rows[0].accountName).toBe("Cuenta principal");
    expect(rows[0].transferAccountName).toBeNull();
    expect(rows[0].transferAccountUnknown).toBe(true);
  });

  it("deja transferAccountName en null para gastos e ingresos", () => {
    const rows = toMovementRows(
      [
        movement({ id: "e1", transfer_account_id: null }),
        movement({ id: "i1", direction: "income", category_id: "c2", transfer_account_id: null }),
      ],
      accounts,
      categories,
    );
    expect(rows.map((r) => r.transferAccountName)).toEqual([null, null]);
  });

  it("marca la transferencia como no editable (solo crear/eliminar)", () => {
    const rows = toMovementRows(
      [
        movement({ id: "t3", direction: "transfer", category_id: null, transfer_account_id: "a2" }),
        movement({ id: "e2" }),
        movement({ id: "i2", direction: "income", category_id: "c2" }),
      ],
      accounts,
      categories,
    );
    expect(rows.map((r) => r.editable)).toEqual([false, true, true]);
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

  // D2.6 #1: una transferencia no suma a ninguna serie aunque lleve la
  // categoría de la fila (el backend la prohíbe, el transform debe excluirla).
  it("excluye transferencias aunque compartan la categoría consultada", () => {
    const withTransfer: MovementWire[] = [
      ...wires,
      movement({
        id: "m6",
        direction: "transfer",
        amount: "500.00",
        category_id: "c1",
        account_id: "a1",
        transfer_account_id: "a2",
      }),
    ];
    expect(toCategoryMovementTotals(withTransfer, byAccount, "COP", "c1")).toEqual({
      expense: 100,
      income: 50,
    });
  });
});

describe("toTotalBalance", () => {
  it("sums same-currency balances only", () => {
    const total = toTotalBalance(
      [
        account({ id: "a1", currency: "COP", balance: 100000 }),
        account({ id: "a2", currency: "COP", balance: -500 }),
        account({ id: "a3", currency: "USD", balance: 99999 }),
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
