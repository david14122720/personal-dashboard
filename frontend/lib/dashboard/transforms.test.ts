import { describe, expect, it } from "vitest";
import {
  currentMonthKey,
  ledDotClass,
  longestStreak,
  monthBalance,
  monthsAgoStart,
  savingsRate,
  toDonutSlices,
  toFlowPoints,
  toISODate,
  worstAlertLevel,
  worstBudgetStatus,
} from "./transforms";

describe("dashboard transforms", () => {
  it("coerces decimal-string aggregates to numbers with balances", () => {
    const points = toFlowPoints([
      { month: "2026-09", income: "1000.00", expense: "400.00" },
    ]);
    expect(points).toEqual([{ month: "2026-09", income: 1000, expense: 400, balance: 600 }]);
  });

  it("returns empty arrays for null or empty aggregates", () => {
    expect(toFlowPoints(null)).toEqual([]);
    expect(toFlowPoints([])).toEqual([]);
    expect(toDonutSlices(undefined)).toEqual([]);
    expect(toDonutSlices([])).toEqual([]);
  });

  it("coerces invalid money strings to zero instead of NaN", () => {
    const points = toFlowPoints([{ month: "2026-09", income: "oops", expense: "" }]);
    expect(points[0].income).toBe(0);
    expect(points[0].expense).toBe(0);
    expect(points[0].balance).toBe(0);
  });

  it("coerces category totals to donut slices", () => {
    expect(
      toDonutSlices([{ category_id: "c1", name: "Food", total: "35.75" }]),
    ).toEqual([{ id: "c1", name: "Food", value: 35.75 }]);
  });

  it("maps backend enums 1:1 to LED tokens", () => {
    expect(ledDotClass("ok")).toBe("bg-flow");
    expect(ledDotClass("warn")).toBe("bg-signal");
    expect(ledDotClass("over")).toBe("bg-alert");
    expect(ledDotClass("high")).toBe("bg-alert");
    expect(ledDotClass("bogus")).toBe("bg-instrument/30");
    expect(ledDotClass(null)).toBe("bg-instrument/30");
  });

  it("rolls budgets up to the worst status", () => {
    expect(worstBudgetStatus([])).toBe("none");
    expect(worstBudgetStatus(["ok", "ok"])).toBe("ok");
    expect(worstBudgetStatus(["ok", "warn"])).toBe("warn");
    expect(worstBudgetStatus(["warn", "over", "ok"])).toBe("over");
  });

  it("rolls account alerts up with high beating warn", () => {
    expect(worstAlertLevel([])).toBe("none");
    expect(worstAlertLevel(["ok", "warn"])).toBe("warn");
    expect(worstAlertLevel(["warn", "high"])).toBe("high");
    expect(worstAlertLevel([null, undefined])).toBe("none");
  });

  it("computes savings rate and guards zero income", () => {
    expect(savingsRate(1000, 400)).toBeCloseTo(0.6);
    expect(savingsRate(0, 0)).toBeNull();
    expect(savingsRate(-50, 10)).toBeNull();
  });

  it("finds the longest habit streak", () => {
    expect(longestStreak([])).toBe(0);
    expect(longestStreak(null)).toBe(0);
    expect(
      longestStreak([{ current_streak: 3 }, { current_streak: 12 }, { current_streak: 7 }]),
    ).toBe(12);
  });

  it("reads the balance for a month key", () => {
    const points = toFlowPoints([{ month: "2026-09", income: "1000.00", expense: "400.00" }]);
    expect(monthBalance(points, "2026-09")).toBe(600);
    expect(monthBalance(points, "2026-08")).toBe(0);
  });

  it("formats date helpers as local calendar strings", () => {
    const now = new Date(2026, 8, 7); // September 7, 2026 (local)
    expect(currentMonthKey(now)).toBe("2026-09");
    expect(monthsAgoStart(now, 11)).toBe("2025-10-01");
    expect(toISODate(now)).toBe("2026-09-07");
  });
});
