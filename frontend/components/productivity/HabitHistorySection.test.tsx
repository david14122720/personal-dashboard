"use client";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import HabitHistorySection from "@/components/productivity/HabitHistorySection";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const habits = [
  { habit_id: "h1", name: "Correr" },
  { habit_id: "h2", name: "Leer" },
];

const logs = [
  { habit_id: "h1", log_date: "2026-09-01", status: "done" },
  { habit_id: "h1", log_date: "2026-09-02", status: "missed" },
  { habit_id: "h1", log_date: "2026-09-04", status: "skipped" },
  { habit_id: "h2", log_date: "2026-09-01", status: "done" },
  { habit_id: "h2", log_date: "2026-09-02", status: "done" },
];

const server = setupServer(
  http.get("http://test.local/api/habits/logs", () => HttpResponse.json(logs)),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderSection() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <HabitHistorySection habits={habits} monthKey="2026-09" />
    </SWRConfig>,
  );
}

describe("HabitHistorySection (S2b RED)", () => {
  it("renders a 42-cell real-log calendar with a name-only selector and base stats", async () => {
    renderSection();
    const section = await screen.findByRole("region", { name: "Historial" });
    expect(within(section).getByRole("combobox", { name: "Hábito" })).toHaveTextContent("Correr");
    expect(section.textContent).not.toContain("h1");
    const grid = within(section).getByRole("grid", { name: "Correr" });
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(42);
    expect(within(section).getByRole("img", { name: "Correr recent completions" })).toBeInTheDocument();
    expect(within(section).getByText("Mejor racha")).toBeInTheDocument();
    expect(within(section).getByText("Cumplimiento")).toBeInTheDocument();
  });

  it("shows a Spanish EmptyState when the month has no logs", async () => {
    server.use(http.get("http://test.local/api/habits/logs", () => HttpResponse.json([])));
    renderSection();
    expect(await screen.findByText("Sin registros en este período")).toBeInTheDocument();
  });

  it("compares two habits by name and aggregates S/M/A without errors", async () => {
    renderSection();
    const section = await screen.findByRole("region", { name: "Historial" });
    fireEvent.click(within(section).getByRole("checkbox", { name: "Leer" }));
    for (const view of ["Semana", "Mes", "Año"] as const) {
      fireEvent.click(within(section).getByRole("button", { name: view }));
      expect(await within(section).findByRole("img", { name: "Evolución" })).toBeInTheDocument();
    }
    const legend = within(section).getByRole("list", { name: "Comparar" });
    expect(within(legend).getByText("Correr")).toBeInTheDocument();
    expect(within(legend).getByText("Leer")).toBeInTheDocument();
  });

  it("shows a per-widget Spanish error with retry when history fails", async () => {
    server.use(http.get("http://test.local/api/habits/logs", () => HttpResponse.error()));
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <HabitHistorySection habits={habits} monthKey="2026-09" />
      </SWRConfig>,
    );
    expect(await screen.findByText("No se pudo cargar el historial")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  });
});
