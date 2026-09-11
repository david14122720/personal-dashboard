import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import ReportsScreens from "@/components/containers/ReportsScreens";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const seen: string[] = [];

const server = setupServer(
  http.get("http://test.local/api/transactions/stats/monthly-flow", ({ request }) => {
    seen.push(request.url);
    return HttpResponse.json([{ month: "2026-09", income: "1000.00", expense: "400.00" }]);
  }),
  http.get("http://test.local/api/transactions/stats/by-category", ({ request }) => {
    seen.push(request.url);
    return HttpResponse.json([{ category_id: "c1", name: "Mercado", total: "1500.00" }]);
  }),
  http.get("http://test.local/api/habits/today", () => {
    return HttpResponse.json([
      { habit_id: "h1", name: "Leer", habit_frequency: "daily", days_of_week: [], current_streak: 2, today_status: "done" },
    ]);
  }),
  http.get("http://test.local/api/habits/logs", ({ request }) => {
    seen.push(request.url);
    return HttpResponse.json([{ habit_id: "h1", log_date: "2026-09-05", status: "done" }]);
  }),
  http.get("http://test.local/api/goals", () => {
    return HttpResponse.json([
      { id: "g1", name: "Maratón", description: null, area: "health", start_date: "2026-01-01", due_date: null, progress: 60, status: "active", color: null },
    ]);
  }),
  http.get("http://test.local/api/tasks", ({ request }) => {
    seen.push(request.url);
    return HttpResponse.json([
      { id: "t1", title: "Hecha en rango", description: null, priority: "medium", status: "completed", due_date: null, completed_at: "2026-09-10T12:00:00Z", goal_id: null, sort_order: 0 },
      { id: "t2", title: "Hecha fuera", description: null, priority: "medium", status: "completed", due_date: null, completed_at: "2026-08-01T12:00:00Z", goal_id: null, sort_order: 1 },
    ]);
  }),
  http.get("http://test.local/api/events", ({ request }) => {
    seen.push(request.url);
    return HttpResponse.json([
      { id: "e1", title: "Cita", description: null, kind: "event", starts_at: "2026-09-12T12:00:00Z", ends_at: null, all_day: false, location: null },
    ]);
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seen.length = 0;
});
afterAll(() => server.close());

function renderReports() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ReportsScreens now={new Date(2026, 8, 15)} />
    </SWRConfig>,
  );
}

describe("ReportsScreens S3 RED", () => {
  it("periodo 2026-09 propaga 2026-09-01..30 a los 4 bloques", async () => {
    renderReports();
    expect(await screen.findByText("Mercado")).toBeInTheDocument();
    expect(await screen.findByText("Leer")).toBeInTheDocument();
    expect(await screen.findByText("Maratón")).toBeInTheDocument();
    expect(await screen.findByText("Hecha en rango")).toBeInTheDocument();
    expect(await screen.findByText("Cita")).toBeInTheDocument();
    expect(screen.queryByText("Hecha fuera")).not.toBeInTheDocument();
    const urls = seen.join("\n");
    expect(urls).toContain("from=2026-09-01");
    expect(urls).toContain("to=2026-09-30");
    expect((await screen.findAllByText(/600/)).length).toBeGreaterThanOrEqual(1);
  });

  it("custom from/to exacto llega a cada bloque", async () => {
    renderReports();
    const periodRegion = await screen.findByRole("region", { name: "Período" });
    fireEvent.click(within(periodRegion).getByRole("radio", { name: "Personalizado" }));
    fireEvent.change(within(periodRegion).getByLabelText("Desde"), { target: { value: "2026-09-05" } });
    fireEvent.change(within(periodRegion).getByLabelText("Hasta"), { target: { value: "2026-09-12" } });
    expect(await screen.findByText("Cita")).toBeInTheDocument();
    const urls = seen.join("\n");
    expect(urls).toContain("from=2026-09-05");
    expect(urls).toContain("to=2026-09-12");
  });

  it("custom invalido bloquea agregados sin romper (precedente finance.test.tsx:630)", async () => {
    renderReports();
    const periodRegion = await screen.findByRole("region", { name: "Período" });
    fireEvent.click(within(periodRegion).getByRole("radio", { name: "Personalizado" }));
    fireEvent.change(within(periodRegion).getByLabelText("Desde"), { target: { value: "2026-09-10" } });
    fireEvent.change(within(periodRegion).getByLabelText("Hasta"), { target: { value: "2026-09-01" } });
    expect(await within(periodRegion).findByRole("alert")).toHaveTextContent("no es válido");
    expect(screen.getByRole("region", { name: "Período" })).toBeInTheDocument();
  });

  it("by-category caido aisla el error solo en el bloque finanzas", async () => {
    server.use(
      http.get("http://test.local/api/transactions/stats/by-category", () => {
        return HttpResponse.json({ message: "caído" }, { status: 500 });
      }),
    );
    renderReports();
    const financeRegion = await screen.findByRole("region", { name: "Finanzas del período" });
    expect(within(financeRegion).getByRole("alert")).toBeInTheDocument();
    expect(await screen.findByText("Leer")).toBeInTheDocument();
    expect(await screen.findByText("Maratón")).toBeInTheDocument();
    expect(await screen.findByText("Cita")).toBeInTheDocument();
  });

  it("no existe boton, link ni ruta PDF-Excel", async () => {
    renderReports();
    await screen.findByRole("region", { name: "Período" });
    expect(screen.queryByRole("button", { name: /pdf|excel|xlsx/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /pdf|excel|xlsx/i })).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/pdf|excel|xlsx/i);
  });
});
