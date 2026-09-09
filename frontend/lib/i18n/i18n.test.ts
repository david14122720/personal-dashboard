import { describe, expect, it } from "vitest";
import { chartToken, formatMonth, t } from "./index";

describe("i18n foundation", () => {
  it("resolves core Spanish copy", () => {
    expect(t("nav.overview")).toBe("Resumen");
    expect(t("nav.finance")).toBe("Finanzas");
    expect(t("login.submit")).toBe("Iniciar sesión");
    expect(t("common.loading")).toBe("Cargando…");
  });

  it("substitutes vars", () => {
    expect(t("common.greeting", { name: "Ana" })).toBe("Hola, Ana");
  });

  it("formats chart months in Spanish", () => {
    const label = formatMonth("2026-09");
    expect(label).not.toBe("2026-09");
    expect(label).toContain("2026");
  });

  it("returns invalid month keys untouched", () => {
    expect(formatMonth("not-a-month")).toBe("not-a-month");
    expect(formatMonth("2026-13")).toBe("2026-13");
  });

  it("rejects unknown keys at build time", () => {
    // @ts-expect-error unknown key must fail type-check
    expect(() => t("missing.key")).toThrow();
  });
});

describe("chartToken", () => {
  it("reads CSS custom properties via getComputedStyle", () => {
    document.documentElement.style.setProperty(
      "--color-flow",
      "oklch(81% 0.14 195)",
    );
    expect(chartToken("--color-flow")).toBe("oklch(81% 0.14 195)");
    document.documentElement.style.removeProperty("--color-flow");
  });

  it("trims surrounding whitespace", () => {
    document.documentElement.style.setProperty("--color-signal", "  blue  ");
    expect(chartToken("--color-signal")).toBe("blue");
    document.documentElement.style.removeProperty("--color-signal");
  });

  it("returns empty string for unset tokens", () => {
    expect(chartToken("--color-missing-token")).toBe("");
  });
});
