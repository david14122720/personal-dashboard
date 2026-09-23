import { describe, expect, it } from "vitest";
import { toFinanceScore, toMonthlyCost } from "@/lib/dashboard/transforms";

// JD-INSIGHT retired with the ledger (S3b): the finance score now comes from
// surviving inputs only. Triangulate its edges: zero, debt-free, underwater.
describe("JD-INSIGHT toFinanceScore bordes (S3b)", () => {
  it("todo cero → null, nunca un puntaje inventado", () => {
    expect(toFinanceScore({ netWorth: 0, savings: 0, debt: 0 })).toBeNull();
  });
  it("sin deuda con posición positiva → 100", () => {
    expect(toFinanceScore({ netWorth: 80, savings: 20, debt: 0 })).toBe(100);
  });
  it("posición negativa → 0 (clamp, sin negativo)", () => {
    expect(toFinanceScore({ netWorth: -200, savings: 0, debt: 100 })).toBe(0);
    expect(toFinanceScore({ netWorth: 50, savings: 0, debt: 150 })).toBeLessThanOrEqual(100);
  });
  it("proporción exacta 100·(nw+s)/(nw+s+d)", () => {
    expect(toFinanceScore({ netWorth: 80, savings: 20, debt: 100 })).toBeCloseTo(50);
    expect(toFinanceScore({ netWorth: 0, savings: 30, debt: 70 })).toBeCloseTo(30);
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
