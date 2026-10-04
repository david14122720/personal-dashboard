import { describe, expect, it } from "vitest";
import { toFinanceScore, toMonthlyCost } from "@/lib/dashboard/transforms";
import type { MovementWire } from "@/lib/api/finance";
import {
  toCategoryMovementTotals,
  toCategoryTrend,
  toExpenseByCategory,
  toTotalTrend,
} from "./finance";

// S-H: the finance score is net-worth-only (100/0/null, presentational).
// Triangulate its edges: no data, positive, zero, negative.
describe("JD-INSIGHT toFinanceScore bordes (S-H)", () => {
  it("sin datos → null, nunca un puntaje inventado", () => {
    expect(toFinanceScore({ netWorth: null })).toBeNull();
    expect(toFinanceScore({ netWorth: undefined })).toBeNull();
  });
  it("patrimonio positivo → 100", () => {
    expect(toFinanceScore({ netWorth: 80 })).toBe(100);
  });
  it("cero o negativo → 0 (presentacional, sin veredicto)", () => {
    expect(toFinanceScore({ netWorth: 0 })).toBe(0);
    expect(toFinanceScore({ netWorth: -200 })).toBe(0);
  });
});

describe("JD-INSIGHT toMonthlyCost bordes (S3b)", () => {
  it("frecuencia desconocida se excluye, nunca 1x silencioso", () => {
    expect(toMonthlyCost([{ price: "9999", frequency: "mystery", is_active: true }])).toBe(0);
  });
  it("inactiva se excluye aunque la frecuencia sea válida", () => {
    expect(toMonthlyCost([{ price: "5000", frequency: "monthly", is_active: false }])).toBe(0);
  });
  it("vacío → 0", () => {
    expect(toMonthlyCost([])).toBe(0);
    expect(toMonthlyCost(null)).toBe(0);
  });
});

// W2 D2.6: ninguna dirección fuera de expense/income puede caer en la serie
// `ingreso` por defecto. Se simula una dirección futura desconocida: los
// cuatro agregados deben ignorarla por completo, no inventarle un ingreso.
describe("JD-W2 una dirección desconocida nunca se cuenta como ingreso", () => {
  const now = new Date(2026, 9, 3, 12, 0, 0); // sábado 3 de octubre de 2026
  const byAccount = new Map([["a1", "COP"]]);
  const unknownDirection: MovementWire = {
    id: "x1",
    direction: "refund" as unknown as MovementWire["direction"],
    amount: "500.00",
    occurred_on: "2026-10-03",
    description: null,
    account_id: "a1",
    category_id: "c1",
    subscription_id: null,
    created_at: "2026-10-03T10:00:00Z",
    updated_at: "2026-10-03T10:00:00Z",
  };

  it("toCategoryMovementTotals no la suma a ninguna serie", () => {
    expect(toCategoryMovementTotals([unknownDirection], byAccount, "COP", "c1")).toEqual({
      expense: 0,
      income: 0,
    });
  });

  it("toCategoryTrend y toTotalTrend no la convierten en ingreso", () => {
    const category = toCategoryTrend([unknownDirection], {
      categoryId: "c1",
      period: "day",
      currencyByAccountId: byAccount,
      userCurrency: "COP",
      now,
    });
    expect(category.every((b) => b.expense === 0 && b.income === 0)).toBe(true);
    const total = toTotalTrend([unknownDirection], {
      period: "day",
      currencyByAccountId: byAccount,
      userCurrency: "COP",
      now,
    });
    expect(total.every((b) => b.expense === 0 && b.income === 0)).toBe(true);
  });

  it("toExpenseByCategory no le crea una rebanada de gasto", () => {
    expect(
      toExpenseByCategory([unknownDirection], {
        range: { from: "2026-10-01", to: "2026-10-31" },
        categories: [
          {
            id: "c1",
            kind: "finance",
            name: "Comida",
            color: null,
            icon: null,
            is_archived: false,
            created_at: "2026-10-01T00:00:00Z",
          },
        ],
        currencyByAccountId: byAccount,
        userCurrency: "COP",
      }),
    ).toEqual([]);
  });
});
