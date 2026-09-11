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

const seen: string[] = [];

const server = setupServer(
  http.get("http://test.local/api/habits/logs", ({ request }) => {
    seen.push(request.url);
    return HttpResponse.json(logs);
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seen.length = 0;
});
afterAll(() => server.close());

function renderSection() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <HabitHistorySection habits={habits} monthKey="2026-09" />
    </SWRConfig>,
  );
}

function wrap(node: React.ReactNode, extra: Record<string, unknown> = {}) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, ...extra }}>{node}</SWRConfig>
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
    expect(within(section).getByText("Mejor racha")).toBeInTheDocument();
    expect(within(section).getByText("Cumplimiento")).toBeInTheDocument();
  });

  it("shows a Spanish EmptyState when the month has no logs", async () => {
    server.use(http.get("http://test.local/api/habits/logs", () => HttpResponse.json([])));
    renderSection();
    const section = await screen.findByRole("region", { name: "Historial" });
    // W-02: el vacío del calendario y el de evolución tienen copy propia (getByText
    // exige unicidad): compartirla duplicaba el texto y volvía intermitente el query.
    expect(await within(section).findByText("Sin datos de evolución en este período")).toBeInTheDocument();
    expect(within(section).getByText("Sin registros en este período")).toBeInTheDocument();
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

describe("HabitHistorySection JD-1 fixes", () => {
  it("H-01: siembra el comparador cuando los hábitos llegan después del primer render", async () => {
    const { rerender } = render(wrap(<HabitHistorySection habits={[]} monthKey="2026-09" />));
    rerender(wrap(<HabitHistorySection habits={habits} monthKey="2026-09" />));
    const section = await screen.findByRole("region", { name: "Historial" });
    const legend = await within(section).findByRole("list", { name: "Comparar" });
    expect(within(legend).getByText("Correr")).toBeInTheDocument();
  });

  it("H-02: deriva el mes por defecto del reloj local y no de UTC", async () => {
    // El runner está en America/Bogota (UTC-5): el 31 de diciembre de 2029 a las
    // 23:00 locales ya es 1 de enero de 2030 en UTC, así que `toISOString()`
    // pediría 2030-01 en vez del mes local 2029-12.
    render(wrap(<HabitHistorySection habits={habits} now={new Date(2029, 11, 31, 23, 0, 0)} />));
    await screen.findByRole("region", { name: "Historial" });
    const url = decodeURIComponent(seen.find((entry) => entry.includes("/habits/logs")) ?? "");
    expect(url).toContain("from=2029-12-01");
    expect(url).toContain("to=2029-12-31");
  });

  it("W-03: etiqueta el heatmap en español, sin literales en inglés", async () => {
    renderSection();
    const section = await screen.findByRole("region", { name: "Historial" });
    const heatmap = within(section).getByRole("img", { name: "Correr: cumplimientos recientes" });
    expect(heatmap.getAttribute("aria-label")).not.toMatch(/recent completions/i);
    expect(within(section).getByTitle("2026-09-01: cumplido")).toBeInTheDocument();
    expect(within(section).getByTitle("2026-09-02: no cumplido")).toBeInTheDocument();
    expect(section.innerHTML).not.toMatch(/recent completions|day \d/i);
  });

  it("W-04: grid con 6 filas y un solo tab stop (celdas no enfocables)", async () => {
    renderSection();
    const section = await screen.findByRole("region", { name: "Historial" });
    const grid = within(section).getByRole("grid", { name: "Correr" });
    expect(within(grid).getAllByRole("row")).toHaveLength(6);
    const cells = within(grid).getAllByRole("gridcell");
    expect(cells).toHaveLength(42);
    expect(cells.every((cell) => !cell.hasAttribute("tabindex"))).toBe(true);
    expect(grid).toHaveAttribute("tabindex", "0");
  });

  it("W-07: muestra la racha actual del API y no la del mes", async () => {
    server.use(
      http.get("http://test.local/api/habits/logs", () =>
        HttpResponse.json([
          { habit_id: "h1", log_date: "2026-09-01", status: "done" },
          { habit_id: "h1", log_date: "2026-09-02", status: "done" },
          { habit_id: "h1", log_date: "2026-09-03", status: "done" },
        ]),
      ),
    );
    render(
      wrap(<HabitHistorySection habits={[{ habit_id: "h1", name: "Correr", current_streak: 7 }]} monthKey="2026-09" />),
    );
    const section = await screen.findByRole("region", { name: "Historial" });
    expect(within(section).getByText("7 días")).toBeInTheDocument();
    expect(within(section).getByText("3 días")).toBeInTheDocument();
  });
});
