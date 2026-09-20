import { describe, expect, it } from "vitest";
import {
  MONTHLY_GOAL_PCT,
  activeHabits,
  categoriesCovered,
  complianceDelta,
  expectedDates,
  findMilestone,
  isExpected,
  levelForXp,
  longestStreak,
  monthDays,
  monthlyCompliance,
  reflectionLine,
  todayCompletion,
  totalXp,
  weekdayConsistency,
  xpForLogs,
  type DashHabit,
  type DashLog,
} from "@/lib/productivity/habitDashboard";

const TODAY = "2026-09-24"; // Thursday
const DAY_MS = 86_400_000;

const habit = (over: Partial<DashHabit> & { id: string }): DashHabit => ({
  name: over.id,
  direction: "build",
  frequency: "daily",
  daysOfWeek: [],
  startDate: "2026-01-01",
  endDate: null,
  category: null,
  shortLabel: null,
  isArchived: false,
  ...over,
});

const log = (habitId: string, date: string, status = "done"): DashLog => ({ habitId, date, status });

const doneDaily = (habitId: string, from: string, to: string): DashLog[] => {
  const entries: DashLog[] = [];
  const endMs = Date.parse(`${to}T00:00:00Z`);
  for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= endMs; ms += DAY_MS) {
    entries.push(log(habitId, new Date(ms).toISOString().slice(0, 10)));
  }
  return entries;
};

describe("habitDashboard dates", () => {
  it("builds every day of a month and rejects bad keys", () => {
    const september = monthDays("2026-09");
    expect(september).toHaveLength(30);
    expect(september[0]).toBe("2026-09-01");
    expect(september[29]).toBe("2026-09-30");
    expect(monthDays("2026-02")).toHaveLength(28);
    expect(monthDays("2024-02")).toHaveLength(29); // leap year
    for (const bad of ["2026-13", "2026-00", "2026-1", "", "nope"]) {
      expect(monthDays(bad)).toEqual([]);
    }
  });

  it("respects range, today cap and frequency mask", () => {
    const bounded = habit({ id: "d", startDate: "2026-09-10", endDate: "2026-09-20" });
    expect(isExpected(bounded, "2026-09-09", TODAY)).toBe(false);
    expect(isExpected(bounded, "2026-09-10", TODAY)).toBe(true);
    expect(isExpected(bounded, "2026-09-20", TODAY)).toBe(true);
    expect(isExpected(bounded, "2026-09-21", TODAY)).toBe(false);
    expect(isExpected(habit({ id: "x" }), "2026-09-25", TODAY)).toBe(false); // after today
    expect(isExpected(habit({ id: "s" }), "2026-09-06", TODAY)).toBe(true); // empty mask = every day
    const custom = habit({ id: "c", frequency: "custom", daysOfWeek: [1, 3, 5] });
    expect(isExpected(custom, "2026-09-07", TODAY)).toBe(true); // Monday
    expect(isExpected(custom, "2026-09-08", TODAY)).toBe(false); // Tuesday
    expect(isExpected(custom, "2026-09-11", TODAY)).toBe(true); // Friday
  });

  it("caps the current month at today, clips to range and applies the mask", () => {
    const bounded = habit({ id: "h", startDate: "2026-09-10", endDate: "2026-09-20" });
    const expected = ["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15",
      "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"];
    expect(expectedDates(bounded, "2026-09", TODAY)).toEqual(expected);
    expect(expectedDates(bounded, "2026-08", TODAY)).toEqual([]);
    expect(expectedDates(bounded, "2026-10", TODAY)).toEqual([]);
    const masked = habit({ id: "m", frequency: "custom", daysOfWeek: [1] });
    expect(expectedDates(masked, "2026-09", TODAY)).toEqual(["2026-09-07", "2026-09-14", "2026-09-21"]);
  });

  it("returns zero expected for future months", () => {
    const h = habit({ id: "h" });
    const logs = [log("h", "2026-10-01")];
    expect(expectedDates(h, "2026-10", TODAY)).toEqual([]);
    expect(monthlyCompliance([h], logs, "2026-10", TODAY)).toEqual({ pct: 0, done: 0, expected: 0 });
    const week = weekdayConsistency([h], logs, "2026-10", TODAY);
    expect(week.values).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(week.avg).toBe(0);
    expect(activeHabits([h], "2026-10", TODAY)).toEqual([]);
  });
});

describe("habitDashboard compliance", () => {
  it("exposes the single monthly goal constant", () => {
    expect(MONTHLY_GOAL_PCT).toBe(80);
  });

  it("counts only done logs on expected dates, deduplicated and capped at today", () => {
    const h = habit({ id: "h", startDate: "2026-09-01" });
    const logs = [
      ...doneDaily("h", "2026-09-01", "2026-09-12"),
      log("h", "2026-09-02"), // duplicate must not double count
      log("h", "2026-09-25"), // future done log is out of the expected window
      log("h", "2026-09-13", "not_done"),
    ];
    expect(monthlyCompliance([h], logs, "2026-09", TODAY)).toEqual({ pct: 50, done: 12, expected: 24 });
  });

  it("ignores archived habits", () => {
    const habits = [
      habit({ id: "a", startDate: "2026-09-01" }),
      habit({ id: "b", startDate: "2026-09-01", isArchived: true }),
    ];
    const logs = doneDaily("b", "2026-09-01", TODAY);
    expect(monthlyCompliance(habits, logs, "2026-09", TODAY)).toEqual({ pct: 0, done: 0, expected: 24 });
  });

  it("returns null delta when the previous month has no expected days", () => {
    expect(complianceDelta({ pct: 75, done: 15, expected: 20 }, { pct: 0, done: 0, expected: 0 })).toBeNull();
    expect(complianceDelta({ pct: 75, done: 15, expected: 20 }, { pct: 68.8, done: 11, expected: 16 })).toBe(6.2);
    expect(complianceDelta({ pct: 66.7, done: 2, expected: 3 }, { pct: 100, done: 4, expected: 4 })).toBe(-33.3);
  });

  it("selects active habits only (not archived, overlapping the visible month)", () => {
    const habits = [
      habit({ id: "in" }),
      habit({ id: "archived", isArchived: true }),
      habit({ id: "ended", endDate: "2026-08-31" }),
      habit({ id: "future", startDate: "2026-09-25" }),
    ];
    expect(activeHabits(habits, "2026-09", TODAY).map((h) => h.id)).toEqual(["in"]);
    expect(activeHabits(habits, "2026-08", TODAY).map((h) => h.id)).toEqual(["in", "ended"]);
    expect(activeHabits(habits, "2026-10", TODAY)).toEqual([]);
  });

  it("counts distinct non-empty categories", () => {
    expect(categoriesCovered([])).toBe(0);
    expect(
      categoriesCovered([
        habit({ id: "a", category: "Salud & Físico" }),
        habit({ id: "b", category: "Salud & Físico" }),
        habit({ id: "c", category: null }),
        habit({ id: "d", category: "  " }),
        habit({ id: "e", category: "Productividad" }),
      ]),
    ).toBe(2);
  });

  it("compares expected today against done today", () => {
    const habits = [
      habit({ id: "a" }),
      habit({ id: "b" }),
      habit({ id: "c", isArchived: true }),
      habit({ id: "d", startDate: "2026-09-25" }),
    ];
    expect(todayCompletion(habits, [log("a", TODAY), log("c", TODAY)], TODAY)).toEqual({ done: 1, total: 2 });
    expect(todayCompletion([], [], TODAY)).toEqual({ done: 0, total: 0 });
  });
});

describe("habitDashboard streaks", () => {
  it("returns all names for tied longest streaks", () => {
    const h1 = habit({ id: "h1", name: "Entrenamiento" });
    const h2 = habit({ id: "h2", name: "Agua" });
    const logs = [...doneDaily("h1", "2026-09-01", "2026-09-03"), ...doneDaily("h2", "2026-09-05", "2026-09-07")];
    expect(longestStreak([h1, h2], logs)).toEqual({ days: 3, habitNames: ["Entrenamiento", "Agua"] });
  });

  it("breaks the run on a missing expected day and stops at endDate", () => {
    const h = habit({ id: "h", name: "Leer" });
    const gapped = [
      log("h", "2026-09-01"), log("h", "2026-09-02"),
      log("h", "2026-09-04"), log("h", "2026-09-05"), log("h", "2026-09-06"),
    ];
    expect(longestStreak([h], gapped)).toEqual({ days: 3, habitNames: ["Leer"] });
    const bounded = habit({ id: "b", name: "Reto", startDate: "2026-09-01", endDate: "2026-09-03" });
    expect(longestStreak([bounded], doneDaily("b", "2026-09-01", "2026-09-05"))).toEqual({ days: 3, habitNames: ["Reto"] });
  });

  it("walks expected days for custom masks, ignoring off-mask logs", () => {
    const h = habit({ id: "h", name: "Gym", frequency: "custom", daysOfWeek: [1, 3, 5] });
    const logs = [log("h", "2026-09-07"), log("h", "2026-09-08"), log("h", "2026-09-09"), log("h", "2026-09-11")];
    expect(longestStreak([h], logs)).toEqual({ days: 3, habitNames: ["Gym"] });
    expect(longestStreak([], [])).toEqual({ days: 0, habitNames: [] });
  });
});

describe("habitDashboard weekday consistency", () => {
  it("aggregates Monday-first percentages with mean and best day", () => {
    const h = habit({ id: "h" });
    const weekend = ["2026-09-05", "2026-09-06", "2026-09-12", "2026-09-13", "2026-09-19", "2026-09-20"]
      .map((date) => log("h", date));
    const week = weekdayConsistency([h], weekend, "2026-09", TODAY);
    expect(week.values).toEqual([0, 0, 0, 0, 0, 100, 100]);
    expect(week.avg).toBe(28.6);
    expect(week.best).toEqual({ index: 5, pct: 100 });
    expect(week.values.every(Number.isFinite)).toBe(true);
  });

  it("reports 100% across a full done month and zeroes without expected days", () => {
    const h = habit({ id: "h" });
    const full = weekdayConsistency([h], doneDaily("h", "2026-08-01", "2026-08-31"), "2026-08", TODAY);
    expect(full.values).toEqual([100, 100, 100, 100, 100, 100, 100]);
    expect(full.avg).toBe(100);
    expect(full.best).toEqual({ index: 0, pct: 100 });
    const empty = weekdayConsistency([], [], "2026-09", TODAY);
    expect(empty.values).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(empty.avg).toBe(0);
    expect(empty.best).toEqual({ index: 0, pct: 0 });
    expect(empty.values.every(Number.isFinite)).toBe(true);
  });
});

describe("habitDashboard xp and level", () => {
  it("awards 10 XP per done log in the month", () => {
    const logs = [
      log("a", "2026-09-01"), log("a", "2026-09-02"), log("a", "2026-09-03", "not_done"),
      log("a", "2026-08-31"), log("a", "2026-09-04"),
    ];
    expect(xpForLogs(logs, "2026-09")).toBe(30);
    expect(xpForLogs(logs, "nope")).toBe(0);
    expect(totalXp(logs)).toBe(40);
    expect(totalXp([])).toBe(0);
  });

  it("maps XP to level with 499/500 boundaries", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(499)).toBe(1);
    expect(levelForXp(500)).toBe(2);
    expect(levelForXp(999)).toBe(2);
    expect(levelForXp(1000)).toBe(3);
  });
});

describe("habitDashboard milestone", () => {
  it("unlocks a category at 100% over the last 14 days", () => {
    const h = habit({ id: "salud", name: "Correr", category: "Salud & Físico" });
    const logs = doneDaily("salud", "2026-09-11", TODAY);
    expect(findMilestone([h], logs, TODAY)).toEqual({ kind: "category", category: "Salud & Físico" });
  });

  it("falls back to the best current streak of at least 7 days", () => {
    const h = habit({ id: "meditar", name: "Meditar", category: "Mentalidad" });
    const logs = doneDaily("meditar", "2026-09-16", TODAY); // 9 days, gap before
    expect(findMilestone([h], logs, TODAY)).toEqual({ kind: "streak", habitName: "Meditar", days: 9 });
  });

  it("returns null without a perfect category or a 7-day streak", () => {
    const future = habit({ id: "future", category: "Salud & Físico", startDate: "2026-10-01" });
    expect(findMilestone([future], [], TODAY)).toBeNull();
    const short = habit({ id: "meditar", name: "Meditar" });
    expect(findMilestone([short], doneDaily("meditar", "2026-09-20", TODAY), TODAY)).toBeNull();
    expect(findMilestone([], [], TODAY)).toBeNull();
  });
});

describe("habitDashboard reflection", () => {
  it("needs at least 14 days of history", () => {
    const a = habit({ id: "a", name: "A" });
    const b = habit({ id: "b", name: "B" });
    const logs = [...doneDaily("a", "2026-09-18", TODAY), ...doneDaily("b", "2026-09-18", TODAY)];
    expect(reflectionLine([a, b], logs, TODAY)).toBeNull();
    expect(reflectionLine([a, b], [], TODAY)).toBeNull();
  });

  it("returns the habit whose completion lifts overall compliance the most", () => {
    const a = habit({ id: "a", name: "A" });
    const b = habit({ id: "b", name: "B" });
    const logs = [
      ...doneDaily("a", "2026-09-11", "2026-09-17"),
      ...doneDaily("b", "2026-09-11", "2026-09-17"),
      ...doneDaily("b", "2026-09-18", TODAY).map((entry) => ({ ...entry, status: "not_done" })),
    ];
    expect(reflectionLine([a, b], logs, TODAY)).toEqual({ habitName: "A", points: 100 });
  });

  it("returns null when the other habits never diverge", () => {
    const a = habit({ id: "a", name: "A" });
    const b = habit({ id: "b", name: "B" });
    const logs = [...doneDaily("a", "2026-09-11", TODAY), ...doneDaily("b", "2026-09-11", TODAY)];
    expect(reflectionLine([a, b], logs, TODAY)).toBeNull();
  });
});

describe("habitDashboard empty inputs", () => {
  it("never yields NaN or Infinity", () => {
    const noHabits: DashHabit[] = [];
    const noLogs: DashLog[] = [];
    expect(monthlyCompliance(noHabits, noLogs, "2026-09", TODAY)).toEqual({ pct: 0, done: 0, expected: 0 });
    expect(complianceDelta({ pct: 0, done: 0, expected: 0 }, { pct: 0, done: 0, expected: 0 })).toBeNull();
    expect(longestStreak(noHabits, noLogs)).toEqual({ days: 0, habitNames: [] });
    expect(activeHabits(noHabits, "2026-09", TODAY)).toEqual([]);
    expect(categoriesCovered(noHabits)).toBe(0);
    expect(todayCompletion(noHabits, noLogs, TODAY)).toEqual({ done: 0, total: 0 });
    expect(weekdayConsistency(noHabits, noLogs, "2026-09", TODAY)).toEqual({
      values: [0, 0, 0, 0, 0, 0, 0],
      avg: 0,
      best: { index: 0, pct: 0 },
    });
    expect(xpForLogs(noLogs, "2026-09")).toBe(0);
    expect(totalXp(noLogs)).toBe(0);
    expect(findMilestone(noHabits, noLogs, TODAY)).toBeNull();
    expect(reflectionLine(noHabits, noLogs, TODAY)).toBeNull();

    // A habit with expected days but no logs must still avoid NaN.
    const solo = monthlyCompliance([habit({ id: "h", startDate: "2026-09-01" })], noLogs, "2026-09", TODAY);
    expect(solo).toEqual({ pct: 0, done: 0, expected: 24 });
    expect(Number.isFinite(solo.pct)).toBe(true);
    const week = weekdayConsistency([habit({ id: "h", startDate: "2026-09-01" })], noLogs, "2026-09", TODAY);
    expect(week.values.every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(week.avg)).toBe(true);
  });
});
