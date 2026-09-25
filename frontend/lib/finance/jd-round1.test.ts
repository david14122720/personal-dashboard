import { describe, expect, it } from "vitest";
import { toFinanceScore, toMonthlyCost } from "@/lib/dashboard/transforms";

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
