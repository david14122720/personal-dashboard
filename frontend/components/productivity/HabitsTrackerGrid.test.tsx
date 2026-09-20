"use client";

// Technical tests for the month-grid habits tracker. Habits arrive as props
// (the container sources them from `useHabitsToday`); the component reads
// range logs itself through `useHabitsHistory` and logs today through
// `logHabitToday` (POST with 409 -> PATCH fallback).

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import HabitsTrackerGrid from "@/components/productivity/HabitsTrackerGrid";
import { t } from "@/lib/i18n";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const MONTH = "2026-09";
const TODAY = "2026-09-15";

const habits = [
  {
    habit_id: "h1",
    name: "Morning Run",
    habit_frequency: "daily",
    days_of_week: [] as number[],
    current_streak: 5,
    today_status: "pending",
  },
  {
    habit_id: "h2",
    name: "Read",
    habit_frequency: "daily",
    days_of_week: [1] as number[],
    current_streak: 0,
    today_status: "pending",
  },
];

const logs = [
  { habit_id: "h1", log_date: "2026-09-01", status: "done" },
  { habit_id: "h1", log_date: "2026-09-02", status: "missed" },
  { habit_id: "h2", log_date: "2026-09-01", status: "done" },
];

const seenPosts: Array<{ habitId: string; body: unknown }> = [];
const seenPatches: Array<{ habitId: string; date: string; body: unknown }> = [];

const server = setupServer(
  http.get("http://test.local/api/habits/logs", () => HttpResponse.json(logs)),
  http.post("http://test.local/api/habits/:id/logs", async ({ params, request }) => {
    seenPosts.push({ habitId: params.id as string, body: await request.json() });
    return HttpResponse.json({ id: "l1" }, { status: 201 });
  }),
  http.patch("http://test.local/api/habits/:id/logs/:date", async ({ params, request }) => {
    seenPatches.push({
      habitId: params.id as string,
      date: params.date as string,
      body: await request.json(),
    });
    return HttpResponse.json({ id: "l1" });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seenPosts.length = 0;
  seenPatches.length = 0;
});
afterAll(() => server.close());

function renderGrid() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <HabitsTrackerGrid habits={habits} monthKey={MONTH} todayYmd={TODAY} />
    </SWRConfig>,
  );
}

describe("HabitsTrackerGrid", () => {
  it("shows the Spanish title and one row per habit with one cell per month day", async () => {
    renderGrid();
    expect(await screen.findByRole("heading", { name: "Rastreador de hábitos" })).toBeInTheDocument();
    const grid = await screen.findByRole("grid", { name: "Rastreador de hábitos" });
    // September 2026 has 30 days; two habit rows give 60 gridcells.
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(60);
    expect(within(grid).getAllByRole("row")).toHaveLength(3);
    expect(within(grid).getByRole("rowheader", { name: /Morning Run/ })).toBeInTheDocument();
    expect(within(grid).getByRole("rowheader", { name: /Read/ })).toBeInTheDocument();
  });

  it("paints a done day with color and an unlogged day without the done color", async () => {
    renderGrid();
    const grid = await screen.findByRole("grid", { name: "Rastreador de hábitos" });
    const done = within(grid).getByRole("gridcell", { name: "Morning Run, 2026-09-01, hecho" });
    expect(done).toHaveClass("bg-flow");
    const pending = within(grid).getByRole("gridcell", { name: "Morning Run, 2026-09-03, pendiente" });
    expect(pending).not.toHaveClass("bg-flow");
    expect(pending).toHaveClass("bg-signal/30");
  });

  it("keeps off-schedule days empty instead of marking them as missed", async () => {
    renderGrid();
    const grid = await screen.findByRole("grid", { name: "Rastreador de hábitos" });
    // 2026-09-03 is a Thursday; the Read habit only runs on Mondays.
    const offSchedule = within(grid).getByRole("gridcell", {
      name: "Read, 2026-09-03, no programado",
    });
    expect(offSchedule).not.toHaveClass("bg-flow");
    expect(offSchedule).not.toHaveClass("bg-alert");
  });

  it("disables future days and logs today through POST with the current date", async () => {
    renderGrid();
    const grid = await screen.findByRole("grid", { name: "Rastreador de hábitos" });
    const future = within(grid).getByRole("gridcell", {
      name: "Morning Run, 2026-09-20, pendiente",
    });
    expect(future).toHaveAttribute("aria-disabled", "true");

    const todayButton = within(grid).getByRole("gridcell", {
      name: "Registrar Morning Run como hecho",
    });
    expect(todayButton.tagName).toBe("BUTTON");
    fireEvent.click(todayButton);
    await waitFor(() => {
      expect(seenPosts).toHaveLength(1);
    });
    expect(seenPosts[0].habitId).toBe("h1");
    expect(seenPosts[0].body).toEqual({ log_date: TODAY, status: "done" });
  });

  it("resolves every tracker i18n key in neutral Spanish", () => {
    expect(t("productivity.tracker.title")).toBe("Rastreador de hábitos");
    expect(t("productivity.tracker.hint")).toContain("Grilla del mes");
    expect(t("productivity.tracker.empty")).toBeTruthy();
    expect(t("productivity.tracker.loadFailed")).toBeTruthy();
    expect(t("productivity.tracker.logFailed")).toBeTruthy();
    expect(t("productivity.tracker.markToday", { name: "Correr" })).toContain("Correr");
    expect(
      t("productivity.tracker.dayLabel", { name: "Correr", date: "2026-09-01", status: "hecho" }),
    ).toContain("2026-09-01");
    expect(t("productivity.tracker.complianceLabel", { name: "Correr", n: 80 })).toContain("80%");
  });
});
