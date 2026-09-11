import { describe, expect, it } from "vitest";
import {
  eventWhenLabel,
  goalProgressFraction,
  groupTasksByStatus,
  habitStatusLed,
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
