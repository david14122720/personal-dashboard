import { describe, expect, it } from "vitest";
import { habitsHistoryKey, HABITS_HISTORY_KEY } from "@/lib/api/productivity";
import {
  aggregateEvolution,
  calendarStateToHeat,
  complianceRate,
  habitStats,
  logsToCalendarCells,
  type HabitLogEntry,
} from "@/lib/productivity/habitStats";

const log = (habit_id: string, log_date: string, status: string): HabitLogEntry => ({
  habit_id,
  log_date,
  status,
});

describe("habitStats transforms (S2 RED)", () => {
  it("bridges skipped days in streaks", () => {
    const logs = [log("h", "2026-09-01", "done"), log("h", "2026-09-02", "skipped"), log("h", "2026-09-03", "done")];
    const stats = habitStats(logs, "2026-09-01", "2026-09-03");
    expect(stats.bestStreak).toBe(2);
    expect(stats.currentStreak).toBe(2);
  });

  it("breaks streaks on missed and legacy not_done", () => {
    const logs = [
      log("h", "2026-09-01", "done"), log("h", "2026-09-02", "done"), log("h", "2026-09-03", "done"),
      log("h", "2026-09-04", "missed"), log("h", "2026-09-05", "done"), log("h", "2026-09-06", "done"),
    ];
    const stats = habitStats(logs, "2026-09-01", "2026-09-06");
    expect(stats.bestStreak).toBe(3);
    expect(stats.currentStreak).toBe(2);
    const legacy = [log("h", "2026-09-01", "done"), log("h", "2026-09-02", "not_done"), log("h", "2026-09-03", "done")];
    const s2 = habitStats(legacy, "2026-09-01", "2026-09-03");
    expect(s2.bestStreak).toBe(1);
    expect(s2.missed).toBe(1);
  });

  it("excludes skipped from compliance and maps zero denom to zero", () => {
    expect(complianceRate(6, 9)).toBeCloseTo(66.7, 1);
    expect(complianceRate(0, 0)).toBe(0);
    expect(complianceRate(5, 0)).toBe(0);
  });

  it("counts done/missed/skipped/unlogged over scheduled days", () => {
    const logs = [
      log("h", "2026-09-01", "done"), log("h", "2026-09-02", "done"), log("h", "2026-09-03", "done"),
      log("h", "2026-09-04", "done"), log("h", "2026-09-05", "done"), log("h", "2026-09-06", "done"),
      log("h", "2026-09-07", "missed"), log("h", "2026-09-08", "skipped"),
    ];
    const stats = habitStats(logs, "2026-09-01", "2026-09-10");
    expect(stats.done).toBe(6);
    expect(stats.missed).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.unlogged).toBe(2);
    expect(stats.complianceRate).toBeCloseTo(66.7, 1);
  });

  it("excludes days outside the days_of_week mask (0=Sun..6=Sat)", () => {
    const logs = [log("h", "2026-09-07", "done")]; // 2026-09-07 is a Monday
    const weekdayOnly = habitStats(logs, "2026-09-05", "2026-09-07", [1, 2, 3, 4, 5]);
    expect(weekdayOnly.total).toBe(1); // Sat+Sun out, only Monday scheduled
    expect(weekdayOnly.done).toBe(1);
  });

  it("renders four calendar states from real logs", () => {
    const logs = [
      log("h", "2026-09-01", "done"), log("h", "2026-09-02", "missed"),
      log("h", "2026-09-03", "not_done"), log("h", "2026-09-04", "skipped"),
    ];
    const cells = logsToCalendarCells(logs, "h", "2026-09");
    expect(cells).toHaveLength(42);
    const byDate = new Map(cells.map((c) => [c.date, c.state]));
    expect(byDate.get("2026-09-01")).toBe("cumplido");
    expect(byDate.get("2026-09-02")).toBe("no-cumplido");
    expect(byDate.get("2026-09-03")).toBe("no-cumplido");
    expect(byDate.get("2026-09-04")).toBe("omitido");
    expect(byDate.get("2026-09-05")).toBe("sin-registro");
  });

  it("derives heatmap cells from real logs, never from streak math", () => {
    expect(calendarStateToHeat("cumplido")).toBe("done");
    expect(calendarStateToHeat("no-cumplido")).toBe("missed");
    expect(calendarStateToHeat("sin-registro")).toBe("pending");
    expect(calendarStateToHeat("omitido")).toBe("empty");
    const cells = logsToCalendarCells([log("h", "2026-09-01", "done")], "h", "2026-09");
    const heats = cells.map((c) => calendarStateToHeat(c.state));
    expect(heats.filter((h) => h === "done")).toHaveLength(1);
  });

  it("triangulates empty month, large annual range, compare and S/M/A", () => {
    const empty = logsToCalendarCells([], "h", "2026-02");
    expect(empty).toHaveLength(42);
    expect(empty.every((c) => c.state === "sin-registro")).toBe(true);
    const emptyStats = habitStats([], "2026-02-01", "2026-02-28");
    expect(emptyStats.total).toBe(28);
    expect(emptyStats.complianceRate).toBe(0);
    expect(emptyStats.bestStreak).toBe(0);
    const annual = habitStats([log("h", "2026-01-01", "done"), log("h", "2026-12-31", "done")], "2026-01-01", "2026-12-31");
    expect(annual.total).toBe(365);
    expect(annual.done).toBe(2);
    const habits = [{ id: "a", name: "Correr" }, { id: "b", name: "Leer" }];
    const mix = [log("a", "2026-09-01", "done"), log("b", "2026-09-01", "done"), log("b", "2026-09-02", "done")];
    for (const g of ["week", "month", "year"] as const) {
      const series = aggregateEvolution(mix, habits, g);
      expect(series).toHaveLength(2);
      expect(series.map((s) => s.name)).toEqual(["Correr", "Leer"]);
      expect(series[1].points.reduce((n, p) => n + p.done, 0)).toBe(2);
    }
  });

  it("keys the history fetcher with null-key on invalid ranges", () => {
    expect(HABITS_HISTORY_KEY).toBe("habits-history");
    expect(habitsHistoryKey("2026-09-01", "2026-09-30")).toBe("habits-history:2026-09-01:2026-09-30");
    expect(habitsHistoryKey("2026-09-30", "2026-09-01")).toBeNull();
    expect(habitsHistoryKey(null, "2026-09-30")).toBeNull();
  });
});
