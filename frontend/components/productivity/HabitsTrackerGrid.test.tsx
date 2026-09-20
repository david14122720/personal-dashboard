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
  it("renders one row per habit with one cell per month day plus streak and success cells", async () => {
    renderGrid();
    const grid = await screen.findByRole("grid", { name: "Rastreador de hábitos" });
    // September 2026 has 30 days; two habit rows give 60 day cells
    // plus 2 streak cells plus 2 success cells.
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(64);
    expect(within(grid).getAllByRole("row")).toHaveLength(3);
    expect(within(grid).getByRole("rowheader", { name: /Morning Run/ })).toBeInTheDocument();
    expect(within(grid).getByRole("rowheader", { name: /Read/ })).toBeInTheDocument();
  });

  it("shows the schedule subtitle under each habit name", async () => {
    renderGrid();
    const grid = await screen.findByRole("grid", { name: "Rastreador de hábitos" });
    const morning = within(grid).getByRole("rowheader", { name: /Morning Run/ });
    expect(morning).toHaveTextContent("Todos los días");
    const read = within(grid).getByRole("rowheader", { name: /Read/ });
    expect(read).toHaveTextContent("lun");
  });

  it("paints a done day with color and glow and an unlogged day without the done color", async () => {
    renderGrid();
    const grid = await screen.findByRole("grid", { name: "Rastreador de hábitos" });
    const done = within(grid).getByRole("gridcell", { name: "Morning Run, 2026-09-01, hecho" });
    expect(done).toHaveClass("bg-flow");
    expect(done.className).toContain("shadow-");
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

  it("marks the today column header as current date", async () => {
    renderGrid();
    const grid = await screen.findByRole("grid", { name: "Rastreador de hábitos" });
    const todayHeader = within(grid).getByRole("columnheader", { name: "Día 2026-09-15" });
    expect(todayHeader).toHaveAttribute("aria-current", "date");
  });

  it("shows real streak and success cells per habit", async () => {
    renderGrid();
    const grid = await screen.findByRole("grid", { name: "Rastreador de hábitos" });
    expect(within(grid).getByRole("columnheader", { name: "Racha" })).toBeInTheDocument();
    expect(within(grid).getByRole("columnheader", { name: "Éxito" })).toBeInTheDocument();
    // h1: 1 done over 30 scheduled September days -> 3.3%, best streak 1.
    expect(within(grid).getByRole("gridcell", { name: "racha de 1 días" })).toHaveTextContent("1");
    expect(
      within(grid).getByRole("gridcell", { name: "Cumplimiento de Morning Run: 3.3%" }),
    ).toHaveTextContent("3.3%");
    // h2 only runs on Mondays with no Monday log -> 0%, streak 0.
    expect(within(grid).getByRole("gridcell", { name: "racha de 0 días" })).toHaveTextContent("0");
  });

  it("shows the four KPI cards with real month data", async () => {
    renderGrid();
    // Mean of per-habit rates (3.3 + 0) / 2 -> 1.7%.
    const compliance = await screen.findByRole("group", { name: "Cumplimiento mensual" });
    expect(within(compliance).getByText("1.7%")).toBeInTheDocument();
    const streak = await screen.findByRole("group", { name: "Racha más larga" });
    expect(within(streak).getByText("1")).toBeInTheDocument();
    expect(within(streak).getByText("días seguidos")).toBeInTheDocument();
    const active = await screen.findByRole("group", { name: "Hábitos activos" });
    expect(within(active).getByText("2")).toBeInTheDocument();
    // 2026-09-15 is a Tuesday: only the daily habit is scheduled, none done.
    const todayCard = await screen.findByRole("group", { name: "Completados hoy" });
    expect(within(todayCard).getByText("0 de 1")).toBeInTheDocument();
  });

  it("shows the legend with the same swatches plus the HOY pill", async () => {
    renderGrid();
    expect(await screen.findByText("Completado")).toBeInTheDocument();
    expect(screen.getByText("Sin registrar")).toBeInTheDocument();
    expect(screen.getByText("Futuro")).toBeInTheDocument();
    expect(screen.getByText("HOY: 15")).toBeInTheDocument();
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
    expect(t("productivity.tracker.heroLive")).toBe("Métricas en Tiempo Real");
    expect(t("productivity.tracker.heroCycle", { n: 30 })).toContain("30");
    expect(t("productivity.tracker.heroDescription")).toBeTruthy();
    expect(t("productivity.tracker.monthPrev")).toBeTruthy();
    expect(t("productivity.tracker.monthNext")).toBeTruthy();
    expect(t("productivity.tracker.addHabit")).toBe("Añadir Hábito");
    expect(t("productivity.tracker.addHabitSoon")).toBeTruthy();
    expect(t("productivity.tracker.kpiCompliance")).toBe("Cumplimiento mensual");
    expect(t("productivity.tracker.kpiStreak")).toBe("Racha más larga");
    expect(t("productivity.tracker.kpiActive")).toBe("Hábitos activos");
    expect(t("productivity.tracker.kpiToday")).toBe("Completados hoy");
    expect(t("productivity.tracker.streakUnit")).toBe("días seguidos");
    expect(t("productivity.tracker.todayCount", { done: 1, total: 2 })).toBe("1 de 2");
    expect(t("productivity.tracker.legendDone")).toBe("Completado");
    expect(t("productivity.tracker.legendPending")).toBe("Sin registrar");
    expect(t("productivity.tracker.legendFuture")).toBe("Futuro");
    expect(t("productivity.tracker.todayPill", { n: 15 })).toBe("HOY: 15");
    expect(t("productivity.tracker.colHabit")).toBe("Hábito");
    expect(t("productivity.tracker.colStreak")).toBe("Racha");
    expect(t("productivity.tracker.colSuccess")).toBe("Éxito");
    expect(t("productivity.tracker.everyday")).toBe("Todos los días");
  });
});
