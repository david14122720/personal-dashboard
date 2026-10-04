import { describe, expect, it } from "vitest";
import {
  calendarDateLabel,
  dayEntries,
  eventWhenLabel,
  goalProgressFraction,
  groupTasksByStatus,
  habitStatusLed,
  monthGridCells,
  monthGridRange,
  noteExcerpt,
  shiftMonth,
} from "@/lib/productivity/productivity";

describe("productivity transforms", () => {
  it("maps today statuses to LED keys with skipped neutral", () => {
    expect(habitStatusLed("done")).toBe("ok");
    expect(habitStatusLed("pending")).toBe("warn");
    expect(habitStatusLed("missed")).toBe("over");
    expect(habitStatusLed("skipped")).toBeNull();
    expect(habitStatusLed("unknown")).toBeNull();
  });

  it("groups tasks in stable status order", () => {
    const groups = groupTasksByStatus([
      { id: "c", status: "completed" },
      { id: "p", status: "pending" },
      { id: "i", status: "in_progress" },
    ]);
    expect(groups.map((g) => g.status)).toEqual(["pending", "in_progress", "completed"]);
    expect(groups[0].items.map((t) => t.id)).toEqual(["p"]);
  });

  it("clamps goal progress to a 0-1 fraction", () => {
    expect(goalProgressFraction(50)).toBe(0.5);
    expect(goalProgressFraction(0)).toBe(0);
    expect(goalProgressFraction(100)).toBe(1);
    expect(goalProgressFraction(140)).toBe(1);
    expect(goalProgressFraction(null)).toBe(0);
  });

  it("labels event times compactly in Spanish", () => {
    expect(eventWhenLabel("2026-09-07T10:00:00Z", false)).toContain("sept");
    expect(eventWhenLabel("2026-09-07T10:00:00Z", true)).toContain("todo el día");
    expect(eventWhenLabel("not-a-date", false)).toBe("not-a-date");
  });

  it("excerpts note bodies to one line", () => {
    expect(noteExcerpt("  hello\n  world  ")).toBe("hello world");
    expect(noteExcerpt("")).toBe("");
    expect(noteExcerpt(null)).toBe("");
    const long = noteExcerpt("x".repeat(200), 20);
    expect(long.length).toBeLessThanOrEqual(20);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("productivity calendar helpers (W4)", () => {
  it("builds 42 Monday-first cells for a month starting on Thursday", () => {
    const cells = monthGridCells("2026-10", "2026-10-15");
    expect(cells).toHaveLength(42);
    // 2026-10-01 is a Thursday: the grid opens on the Monday before it.
    expect(cells[0].date).toBe("2026-09-28");
    expect(cells[0].inMonth).toBe(false);
    expect(new Date(`${cells[0].date}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(cells[3].date).toBe("2026-10-01");
    expect(cells[3].inMonth).toBe(true);
    expect(cells[3].isToday).toBe(false);
    expect(cells.find((cell) => cell.date === "2026-10-15")?.isToday).toBe(true);
    expect(cells[41].date).toBe("2026-11-08");
    expect(cells[41].inMonth).toBe(false);
  });

  it("keeps a Sunday-starting month inside the Monday-first grid", () => {
    const cells = monthGridCells("2026-11", "2026-11-01");
    // 2026-11-01 is a Sunday: the first column is the Monday before it.
    expect(cells[0].date).toBe("2026-10-26");
    expect(cells[6].date).toBe("2026-11-01");
    expect(cells[6].inMonth).toBe(true);
    expect(cells[6].isToday).toBe(true);
    expect(cells[41].date).toBe("2026-12-06");
  });

  it("includes February 29 in a leap year", () => {
    const cells = monthGridCells("2028-02", "2028-02-10");
    expect(cells).toHaveLength(42);
    expect(cells.find((cell) => cell.date === "2028-02-29")?.inMonth).toBe(true);
    expect(cells.some((cell) => cell.date === "2028-02-30")).toBe(false);
    expect(cells.some((cell) => cell.date === "2028-02-31")).toBe(false);
  });

  it("returns no cells for an invalid month key", () => {
    expect(monthGridCells("2026-13")).toEqual([]);
    expect(monthGridCells("not-a-month")).toEqual([]);
  });

  it("reports the 42-cell grid bounds, not the calendar-month bounds", () => {
    const cells = monthGridCells("2026-10", "2026-10-15");
    expect(monthGridRange("2026-10")).toEqual({ from: "2026-09-28", to: "2026-11-08" });
    expect(monthGridRange("2026-10")).toEqual({ from: cells[0].date, to: cells[41].date });
    expect(monthGridRange("2026-11")).toEqual({ from: "2026-10-26", to: "2026-12-06" });
  });

  it("shifts months across year boundaries", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
    expect(shiftMonth("2026-10", -15)).toBe("2025-07");
    expect(shiftMonth("bogus", 1)).toBe("bogus");
  });

  it("buckets tasks by due_date and events by day overlap", () => {
    // Local-time constructors so the expectations hold in any test timezone.
    const at = (month: number, day: number, hour = 12, minute = 0) =>
      new Date(2026, month - 1, day, hour, minute).toISOString();
    const tasks = [
      { id: "t1", due_date: "2026-10-06" },
      { id: "t2", due_date: "2026-10-07" },
      { id: "t3", due_date: null },
    ];
    const events = [
      { id: "e1", starts_at: at(10, 5), ends_at: at(10, 7, 10) }, // spans 5, 6 and 7
      { id: "e2", starts_at: at(10, 6, 20), ends_at: at(10, 7, 0) }, // ends exactly at midnight
      { id: "e3", starts_at: at(10, 6, 0), ends_at: null }, // point event at midnight
      { id: "e4", starts_at: "not-a-date", ends_at: null },
    ];
    expect(dayEntries(tasks, events, "2026-10-06")).toEqual({
      tasks: [tasks[0]],
      events: [events[0], events[1], events[2]],
    });
    expect(dayEntries(tasks, events, "2026-10-05").events.map((event) => event.id)).toEqual(["e1"]);
    expect(dayEntries(tasks, events, "2026-10-07").events.map((event) => event.id)).toEqual(["e1"]);
    expect(dayEntries(tasks, events, "2026-10-08")).toEqual({ tasks: [], events: [] });
    expect(dayEntries(null, undefined, "2026-10-06")).toEqual({ tasks: [], events: [] });
  });

  it("labels a day in long Spanish", () => {
    expect(calendarDateLabel("2026-10-15")).toContain("octubre");
    expect(calendarDateLabel("2026-10-15")).toContain("15");
    expect(calendarDateLabel("bogus")).toBe("bogus");
  });
});
