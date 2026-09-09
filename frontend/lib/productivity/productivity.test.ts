import { describe, expect, it } from "vitest";
import {
  eventWhenLabel,
  goalProgressFraction,
  groupTasksByStatus,
  habitStatusLed,
  heatmapCells,
  noteExcerpt,
} from "@/lib/productivity/productivity";

describe("productivity transforms", () => {
  it("maps today statuses to LED keys with skipped neutral", () => {
    expect(habitStatusLed("done")).toBe("ok");
    expect(habitStatusLed("pending")).toBe("warn");
    expect(habitStatusLed("missed")).toBe("over");
    expect(habitStatusLed("skipped")).toBeNull();
    expect(habitStatusLed("unknown")).toBeNull();
  });

  it("builds a fixed-width heatmap strip pinned to today", () => {
    const cells = heatmapCells(3, "done", 7);
    expect(cells).toHaveLength(7);
    expect(cells[6]).toBe("done");
    expect(cells[5]).toBe("done");
    expect(cells[4]).toBe("done");
    expect(cells[3]).toBe("empty");
  });

  it("breaks the run visually on a missed today", () => {
    const cells = heatmapCells(0, "missed", 7);
    expect(cells[6]).toBe("missed");
    expect(cells.slice(0, 6).every((c) => c === "empty")).toBe(true);
  });

  it("clamps oversized streaks to the strip width", () => {
    const cells = heatmapCells(99, "pending", 7);
    expect(cells).toHaveLength(7);
    expect(cells[6]).toBe("pending");
    expect(cells.slice(0, 6).every((c) => c === "done")).toBe(true);
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
