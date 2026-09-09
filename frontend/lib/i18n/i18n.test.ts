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

describe("p8 dashboard + notifications copy (PR1 RED)", () => {
  it("resolves 9 widget titles and hints", () => {
    expect(t("dashboard.monthIncome")).toBeTruthy();
    expect(t("dashboard.monthExpense")).toBeTruthy();
    expect(t("dashboard.monthSavings")).toBeTruthy();
    expect(t("dashboard.upcomingPayments")).toBeTruthy();
    expect(t("dashboard.pendingDebts")).toBeTruthy();
    expect(t("dashboard.activeSubs")).toBeTruthy();
    expect(t("dashboard.pendingTasks")).toBeTruthy();
    expect(t("dashboard.upcomingEvents")).toBeTruthy();
    expect(t("dashboard.goalProgress")).toBeTruthy();
  });

  it("resolves toggles, links and empties", () => {
    expect(t("dashboard.widgetHide")).toBeTruthy();
    expect(t("dashboard.widgetShow")).toBeTruthy();
    expect(t("dashboard.viewInFinance")).toBeTruthy();
    expect(t("dashboard.viewInProductivity")).toBeTruthy();
    expect(t("dashboard.upcomingPaymentsEmpty")).toBeTruthy();
  });

  it("resolves bell, sections and empty states", () => {
    expect(t("notifications.bell")).toBeTruthy();
    expect(t("notifications.overdue")).toBeTruthy();
    expect(t("notifications.upcomingCharges")).toBeTruthy();
    expect(t("notifications.noOverdue")).toBe("Sin vencidas 🎉");
    expect(t("notifications.noUpcoming")).toBe("Nada por vencer en 7 días");
  });

  it("interpolates {n} and {date}", () => {
    expect(t("notifications.bellLabel", { n: 4 })).toContain("4");
    expect(t("notifications.dueOn", { date: "12 sept" })).toContain("12 sept");
    expect(t("notifications.amountDue", { amount: "$ 500", date: "12 sept" })).toBe("$ 500 · vence 12 sept");
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
