import { describe, expect, it } from "vitest";
import { formatMoney, toNumber } from "./money";

describe("toNumber (wire string → number boundary)", () => {
  it("coerces decimal strings to numbers", () => {
    expect(toNumber("123.45")).toBe(123.45);
    expect(toNumber("1500000.00")).toBe(1500000);
    expect(toNumber("-42.5")).toBe(-42.5);
  });

  it("passes finite numbers through", () => {
    expect(toNumber(7)).toBe(7);
    expect(toNumber(0)).toBe(0);
  });

  it("maps empty, null, undefined, and garbage to 0", () => {
    expect(toNumber("")).toBe(0);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber("abc")).toBe(0);
    expect(toNumber(Number.NaN)).toBe(0);
    expect(toNumber(Infinity)).toBe(0);
  });
});

describe("formatMoney (locale/currency preferences)", () => {
  it("formats COP per es-CO without decimals", () => {
    const rendered = formatMoney("1500000.00", { locale: "es-CO", currency: "COP" });
    expect(rendered).toContain("1.500.000");
  });

  it("keeps decimals for non-COP currencies", () => {
    const rendered = formatMoney("123.45", { locale: "en-US", currency: "USD" });
    expect(rendered).toContain("123.45");
  });

  it("falls back gracefully for unknown currency codes", () => {
    expect(() => formatMoney("10.00", { locale: "en-US", currency: "XX1" })).not.toThrow();
  });
});
