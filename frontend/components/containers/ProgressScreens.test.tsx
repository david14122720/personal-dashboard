import { render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import ProgressScreens from "@/components/containers/ProgressScreens";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const server = setupServer(
  http.get("http://test.local/api/transactions/stats/monthly-flow", () =>
    HttpResponse.json([{ month: "2026-09", income: "1000.00", expense: "400.00" }]),
  ),
  http.get("http://test.local/api/net-worth", () =>
    HttpResponse.json({
      per_currency: [{ currency: "COP", assets: "5000000.00", debts: "1000000.00", net_worth: "4000000.00" }],
    }),
  ),
  http.get("http://test.local/api/habits/today", () =>
    HttpResponse.json([
      { habit_id: "h1", name: "Leer", habit_frequency: "daily", days_of_week: [], current_streak: 3, today_status: "pending" },
    ]),
  ),
  http.get("http://test.local/api/habits/logs", () =>
    HttpResponse.json([{ habit_id: "h1", log_date: "2026-09-10", status: "done" }]),
  ),
  http.get("http://test.local/api/goals", () =>
    HttpResponse.json([
      { id: "g1", name: "Maratón", description: null, area: "health", start_date: "2026-01-01", due_date: null, progress: 60, status: "active", color: null },
    ]),
  ),
  http.get("http://test.local/api/savings-goals", () =>
    HttpResponse.json([{ id: "s1", name: "Fondo", goal: "1000000.00", saved: "250000.00" }]),
  ),
  http.get("http://test.local/api/tasks", () =>
    HttpResponse.json([
      { id: "t1", title: "Hecha", description: null, priority: "medium", status: "completed", due_date: null, completed_at: "2026-09-10T12:00:00Z", goal_id: null, sort_order: 0 },
    ]),
  ),
  http.get("http://test.local/api/events", () =>
    HttpResponse.json([
      { id: "e1", title: "Cita", description: null, kind: "event", starts_at: "2026-09-20T12:00:00Z", ends_at: null, all_day: false, location: null },
    ]),
  ),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderProgress() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ProgressScreens now={new Date(2026, 8, 15)} />
    </SWRConfig>,
  );
}

const DISCLAIMER = /orientativo/i;

describe("ProgressScreens S4 RED", () => {
  it("muestra 4 indicadores etiquetados de puntaje por área", async () => {
    renderProgress();
    const score = await screen.findByRole("region", { name: "Puntaje por área" });
    for (const label of ["Finanzas", "Hábitos", "Metas", "Productividad"]) {
      expect(within(score).getByText(label)).toBeInTheDocument();
    }
    expect(within(score).getAllByRole("progressbar")).toHaveLength(4);
  });

  it("área sin datos → visual neutro, nunca puntaje fabricado", async () => {
    server.use(http.get("http://test.local/api/habits/logs", () => HttpResponse.json([])));
    renderProgress();
    const score = await screen.findByRole("region", { name: "Puntaje por área" });
    expect(within(score).getAllByText("Sin datos").length).toBeGreaterThanOrEqual(1);
    const habitsBar = within(score).getByRole("progressbar", { name: /Hábitos/ });
    expect(habitsBar).toHaveAttribute("aria-valuenow", "0");
  });

  it("disclaimer visible en estado poblado y en vacío", async () => {
    renderProgress();
    expect(await screen.findByText(DISCLAIMER)).toBeVisible();
    server.use(
      http.get("http://test.local/api/transactions/stats/monthly-flow", () => HttpResponse.json([])),
      http.get("http://test.local/api/net-worth", () => HttpResponse.json({ per_currency: [] })),
      http.get("http://test.local/api/habits/today", () => HttpResponse.json([])),
      http.get("http://test.local/api/habits/logs", () => HttpResponse.json([])),
      http.get("http://test.local/api/goals", () => HttpResponse.json([])),
      http.get("http://test.local/api/savings-goals", () => HttpResponse.json([])),
      http.get("http://test.local/api/tasks", () => HttpResponse.json([])),
      http.get("http://test.local/api/events", () => HttpResponse.json([])),
    );
    const { unmount } = render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ProgressScreens now={new Date(2026, 8, 15)} />
      </SWRConfig>,
    );
    expect((await screen.findAllByText(DISCLAIMER)).length).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it("patrimonio sin ningún control de escritura", async () => {
    renderProgress();
    const worth = await screen.findByRole("region", { name: "Patrimonio" });
    expect(within(worth).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(worth).queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(within(worth).queryByRole("button")).not.toBeInTheDocument();
    expect(within(worth).queryByRole("combobox")).not.toBeInTheDocument();
    expect(worth.innerHTML).not.toMatch(/valuar|valuación/i);
  });
});
