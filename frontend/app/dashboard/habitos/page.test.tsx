import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/dashboard/habitos/",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    h("a", { href, ...rest }, children),
}));

vi.mock("@/lib/productivity/productivity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/productivity/productivity")>();
  return { ...actual, todayYmdLocal: () => "2026-09-15" };
});

import HabitosPage from "./page";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const TODAY = "2026-09-15";
const MONTH = "2026-09";
const DAYS_IN_MONTH = 30;

interface WireHabit {
  id: string;
  name: string;
  description: null;
  direction: string;
  frequency: string;
  days_of_week: number[];
  target_per_period: string | null;
  start_date: string;
  end_date: string | null;
  category_id: null;
  category: string | null;
  short_label: string | null;
  color: string | null;
  icon: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

function habit(overrides: Partial<WireHabit> & { id: string; name: string }): WireHabit {
  return {
    description: null,
    direction: "build",
    frequency: "daily",
    days_of_week: [],
    target_per_period: null,
    start_date: "2026-01-01",
    end_date: null,
    category_id: null,
    category: null,
    short_label: null,
    color: null,
    icon: null,
    is_archived: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const BASE_HABITS: WireHabit[] = [
  habit({
    id: "h1",
    name: "Entrenamiento de fuerza",
    category: "Salud & Físico",
    short_label: "45m",
    color: "#38BDF8",
    icon: "dumbbell",
  }),
  habit({ id: "h2", name: "Agua", category: "Salud & Físico", short_label: "2L", color: "#2DD4BF", icon: "water" }),
  habit({
    id: "h3",
    name: "Leer",
    category: "Mentalidad",
    short_label: "Noche",
    frequency: "custom",
    days_of_week: [1, 3, 5],
    color: "#A78BFA",
    icon: "book",
  }),
  habit({ id: "h4", name: "Deep Work", category: "Productividad", color: "#4F7CFF", icon: "brain" }),
];

const BASE_LOGS = [
  { habit_id: "h1", log_date: "2026-09-01", status: "done" },
  { habit_id: "h2", log_date: "2026-09-02", status: "done" },
];

let habitRows: WireHabit[] = [];
let logRows: Array<{ habit_id: string; log_date: string; status: string }> = [];
const seenLogPosts: Array<{ id: string; body: { log_date: string; status: string } }> = [];
const seenLogDeletes: Array<{ id: string; date: string }> = [];
const seenHabitPosts: Array<Record<string, unknown>> = [];
const historyRanges: string[] = [];

const server = setupServer(
  http.get("http://test.local/api/habits", () => HttpResponse.json(habitRows)),
  http.get("http://test.local/api/habits/logs", ({ request }) => {
    const url = new URL(request.url);
    historyRanges.push(`${url.searchParams.get("from")}|${url.searchParams.get("to")}`);
    return HttpResponse.json(logRows);
  }),
  http.post("http://test.local/api/habits", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    seenHabitPosts.push(body);
    const row = habit({
      id: `h-new-${habitRows.length}`,
      name: String(body.name),
      category: (body.category as string | undefined) ?? null,
      short_label: (body.short_label as string | undefined) ?? null,
      direction: String(body.direction ?? "build"),
      frequency: String(body.frequency ?? "daily"),
      days_of_week: (body.days_of_week as number[] | undefined) ?? [],
    });
    habitRows = [...habitRows, row];
    return HttpResponse.json(row, { status: 201 });
  }),
  http.post("http://test.local/api/habits/:id/logs", async ({ params, request }) => {
    const body = (await request.json()) as { log_date: string; status: string };
    seenLogPosts.push({ id: params.id as string, body });
    logRows = [
      ...logRows.filter((entry) => !(entry.habit_id === params.id && entry.log_date === body.log_date)),
      { habit_id: params.id as string, log_date: body.log_date, status: body.status },
    ];
    return HttpResponse.json({ id: "log1" }, { status: 201 });
  }),
  http.patch("http://test.local/api/habits/:id/logs/:date", async ({ params, request }) => {
    const body = (await request.json()) as { status: string };
    logRows = logRows.map((entry) =>
      entry.habit_id === params.id && entry.log_date === params.date ? { ...entry, status: body.status } : entry,
    );
    return HttpResponse.json({ id: "log1" });
  }),
  http.delete("http://test.local/api/habits/:id/logs/:date", ({ params }) => {
    seenLogDeletes.push({ id: params.id as string, date: params.date as string });
    logRows = logRows.filter((entry) => !(entry.habit_id === params.id && entry.log_date === params.date));
    return new HttpResponse(null, { status: 204 });
  }),
  http.patch("http://test.local/api/habits/:id", ({ params }) => {
    habitRows = habitRows.map((row) => (row.id === params.id ? { ...row, is_archived: true } : row));
    return HttpResponse.json(habitRows.find((row) => row.id === params.id));
  }),
);

beforeAll(() => server.listen());
beforeEach(() => {
  habitRows = BASE_HABITS.map((row) => ({ ...row }));
  logRows = BASE_LOGS.map((row) => ({ ...row }));
  seenLogPosts.length = 0;
  seenLogDeletes.length = 0;
  seenHabitPosts.length = 0;
  historyRanges.length = 0;
});
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
  replace.mockClear();
});
afterAll(() => server.close());

function renderPage() {
  return render(
    h(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, h(HabitosPage, null)),
  );
}

async function findGrid(): Promise<HTMLElement> {
  return screen.findByRole("grid", { name: "Rastreador de Hábitos" });
}

describe("habitos dashboard page", () => {
  it("renders the header with no create form open on load", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    const { container } = renderPage();

    expect(await screen.findByRole("heading", { name: "Rastreador de Hábitos" })).toBeInTheDocument();
    expect(container.textContent).toContain("MÉTRICAS EN TIEMPO REAL");
    expect(container.textContent).toContain("Ciclo Activo 30 Días");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Añadir Hábito" })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalledWith("/login/");
  });

  it("shows the four KPI cards with the exact spec labels", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    renderPage();

    expect(await screen.findByText("CUMPLIMIENTO MENSUAL")).toBeInTheDocument();
    expect(screen.getByText("RACHA MÁS LARGA")).toBeInTheDocument();
    expect(screen.getByText("HÁBITOS ACTIVOS")).toBeInTheDocument();
    expect(screen.getByText(`COMPLETADOS HOY (DÍA ${Number(TODAY.slice(8))})`)).toBeInTheDocument();
    expect(screen.getByText("Meta mensual: 80%")).toBeInTheDocument();
  });

  it("renders filter tabs with real counts, the legend and the HOY badge", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    renderPage();

    expect(await screen.findByRole("button", { name: "Todos (4)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salud & Físico (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Productividad (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mentalidad (1)" })).toBeInTheDocument();
    expect(screen.getByText("Completado")).toBeInTheDocument();
    expect(screen.getByText("Sin registrar")).toBeInTheDocument();
    expect(screen.getByText("Futuro")).toBeInTheDocument();
    expect(screen.getByText("HOY: 15")).toBeInTheDocument();
  });

  it("renders the grid with one row per habit and the three cell states", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    renderPage();
    const grid = await findGrid();

    expect(within(grid).getAllByRole("row")).toHaveLength(5); // header + 4 habits
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(4 * DAYS_IN_MONTH);

    const header = within(grid).getByRole("rowheader", { name: /Entrenamiento de fuerza/ });
    expect(header).toHaveTextContent("Salud & Físico • 45m");

    const done = within(grid).getByRole("gridcell", { name: "Entrenamiento de fuerza, 1 de septiembre: completado" });
    expect(done).toHaveClass("bg-signal");
    expect(done).toHaveAttribute("aria-pressed", "true");

    const pending = within(grid).getByRole("gridcell", { name: "Entrenamiento de fuerza, 3 de septiembre: sin registrar" });
    expect(pending).toHaveAttribute("aria-pressed", "false");
    expect(pending.className).toContain("bg-hull/60");

    const future = within(grid).getByRole("gridcell", { name: "Entrenamiento de fuerza, 20 de septiembre: futuro" });
    expect(future).toBeDisabled();
    expect(future.className).toContain("bg-black/40");

    const unscheduled = within(grid).getByRole("gridcell", { name: "Leer, 10 de septiembre: no programado" });
    expect(unscheduled).toBeDisabled();
  });

  it("ignores future cells and persists past/today toggles through POST then DELETE", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    renderPage();
    const grid = await findGrid();

    const future = within(grid).getByRole("gridcell", { name: "Agua, 16 de septiembre: futuro" });
    fireEvent.click(future);
    expect(seenLogPosts).toHaveLength(0);
    expect(seenLogDeletes).toHaveLength(0);

    fireEvent.click(within(grid).getByRole("gridcell", { name: "Agua, 15 de septiembre: sin registrar" }));
    await waitFor(() => expect(seenLogPosts).toHaveLength(1));
    expect(seenLogPosts[0]).toEqual({ id: "h2", body: { log_date: TODAY, status: "done" } });

    const doneCell = await within(grid).findByRole("gridcell", { name: "Agua, 15 de septiembre: completado" });
    expect(doneCell).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(doneCell);
    await waitFor(() => expect(seenLogDeletes).toEqual([{ id: "h2", date: TODAY }]));
    expect(
      await within(grid).findByRole("gridcell", { name: "Agua, 15 de septiembre: sin registrar" }),
    ).toBeInTheDocument();
  });

  it("reloads data when the month arrows change the visible month", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    renderPage();

    expect(await screen.findByText("Septiembre")).toBeInTheDocument();
    expect(historyRanges).toContain("2025-10-01|2026-09-30");

    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    expect(await screen.findByText("Agosto")).toBeInTheDocument();
    await waitFor(() => expect(historyRanges).toContain("2025-09-01|2026-08-31"));
    expect(await screen.findByRole("button", { name: "Mes siguiente" })).not.toBeDisabled();
  });

  it("opens the create modal with Categoría and Etiqueta corta, and adds a row without reload", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Añadir Hábito" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo hábito" });
    expect(within(dialog).getByText("Categoría")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Etiqueta corta (opcional)")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Correr" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mentalidad" }));
    fireEvent.change(within(dialog).getByLabelText("Etiqueta corta (opcional)"), { target: { value: "Reto" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear" }));

    await waitFor(() => expect(seenHabitPosts).toHaveLength(1));
    expect(seenHabitPosts[0]).toMatchObject({ name: "Correr", category: "Mentalidad", short_label: "Reto" });
    expect(await screen.findByRole("rowheader", { name: /Correr/ })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("renders no NaN/undefined/Infinity anywhere", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    const { container } = renderPage();
    await findGrid();
    expect(container.textContent ?? "").not.toMatch(/NaN|undefined|Infinity/);
  });

  it("redirects to login without a token", () => {
    renderPage();
    expect(replace).toHaveBeenCalledWith("/login/");
  });
});
