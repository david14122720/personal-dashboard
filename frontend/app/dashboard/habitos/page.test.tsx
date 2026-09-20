import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import useSWR, { SWRConfig } from "swr";
import { apiGet } from "@/lib/api/client";
import { HABITS_TODAY_KEY } from "@/lib/api/productivity";

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
let todayFetches = 0;

const server = setupServer(
  http.get("http://test.local/api/habits", () => HttpResponse.json(habitRows)),
  http.get("http://test.local/api/habits/logs", ({ request }) => {
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    historyRanges.push(`${from}|${to}`);
    const rows = logRows.filter((entry) => (!from || entry.log_date >= from) && (!to || entry.log_date <= to));
    return HttpResponse.json(rows);
  }),
  http.get("http://test.local/api/habits/today", () => {
    todayFetches += 1;
    return HttpResponse.json([]);
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
  http.patch("http://test.local/api/habits/:id", async ({ params, request }) => {
    const body = (await request.json()) as { is_archived?: boolean };
    habitRows = habitRows.map((row) =>
      row.id === params.id ? { ...row, is_archived: body.is_archived ?? row.is_archived } : row,
    );
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
  todayFetches = 0;
});
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
  replace.mockClear();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function renderPage() {
  return render(
    h(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, h(HabitosPage, null)),
  );
}

/** Mirrors the dashboard-home habit widget: subscribes to the shared today key. */
function TodayProbe() {
  useSWR(HABITS_TODAY_KEY, () => apiGet<unknown[]>("/habits/today"));
  return null;
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

    const done = within(grid).getByRole("button", { name: "Entrenamiento de fuerza, 1 de septiembre: completado" });
    expect(done).toHaveClass("bg-signal");
    expect(done).toHaveAttribute("aria-pressed", "true");

    const pending = within(grid).getByRole("button", { name: "Entrenamiento de fuerza, 3 de septiembre: sin registrar" });
    expect(pending).toHaveAttribute("aria-pressed", "false");
    expect(pending.className).toContain("bg-hull/60");

    const future = within(grid).getByRole("button", { name: "Entrenamiento de fuerza, 20 de septiembre: futuro" });
    expect(future).toBeDisabled();
    expect(future.className).toContain("bg-black/40");

    const unscheduled = within(grid).getByRole("button", { name: "Leer, 10 de septiembre: no programado" });
    expect(unscheduled).toBeDisabled();
  });

  it("ignores future cells and persists past/today toggles through POST then DELETE", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    renderPage();
    const grid = await findGrid();

    const future = within(grid).getByRole("button", { name: "Agua, 16 de septiembre: futuro" });
    fireEvent.click(future);
    expect(seenLogPosts).toHaveLength(0);
    expect(seenLogDeletes).toHaveLength(0);

    fireEvent.click(within(grid).getByRole("button", { name: "Agua, 15 de septiembre: sin registrar" }));
    await waitFor(() => expect(seenLogPosts).toHaveLength(1));
    expect(seenLogPosts[0]).toEqual({ id: "h2", body: { log_date: TODAY, status: "done" } });

    const doneCell = await within(grid).findByRole("button", { name: "Agua, 15 de septiembre: completado" });
    expect(doneCell).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(doneCell);
    await waitFor(() => expect(seenLogDeletes).toEqual([{ id: "h2", date: TODAY }]));
    expect(
      await within(grid).findByRole("button", { name: "Agua, 15 de septiembre: sin registrar" }),
    ).toBeInTheDocument();
  });

  it("reloads data when the month arrows change the visible month", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    renderPage();

    expect(await screen.findByText("Septiembre")).toBeInTheDocument();
    expect(historyRanges).toContain("2025-10-01|2026-09-30");

    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    expect(await screen.findByText("Agosto")).toBeInTheDocument();
    await waitFor(() => expect(historyRanges).toContain("2025-09-01|2026-09-15"));
    expect(await screen.findByRole("button", { name: "Mes siguiente" })).not.toBeDisabled();
  });

  it("opens the create modal with Categoría and Etiqueta corta, and adds a row without reload", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Añadir Hábito" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo hábito" });
    expect(within(dialog).getByText("Categoría")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Etiqueta corta (opcional)")).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText("Ej. 1.00")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Categoría")).toHaveAttribute("maxlength", "64");

    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Correr" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mentalidad" }));
    fireEvent.change(within(dialog).getByLabelText("Etiqueta corta (opcional)"), { target: { value: "Reto" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear" }));

    await waitFor(() => expect(seenHabitPosts).toHaveLength(1));
    expect(seenHabitPosts[0]).toMatchObject({
      name: "Correr",
      category: "Mentalidad",
      short_label: "Reto",
      start_date: TODAY,
    });
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

  it("keeps today's KPI real when viewing a past month", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    logRows = [...BASE_LOGS, { habit_id: "h1", log_date: TODAY, status: "done" }];
    renderPage();
    await findGrid();

    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    expect(await screen.findByText("Agosto")).toBeInTheDocument();
    await waitFor(() => expect(historyRanges).toContain("2025-09-01|2026-09-15"));

    const kpi = await screen.findByRole("region", { name: "COMPLETADOS HOY (DÍA 15)" });
    expect(within(kpi).getByText("1")).toBeInTheDocument();
    expect(within(kpi).getByText("/3")).toBeInTheDocument();
  });

  it("updates the today KPI optimistically before the toggle mutation resolves", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    server.use(
      http.post(
        "http://test.local/api/habits/:id/logs",
        async ({ params, request }) => {
          const body = (await request.json()) as { log_date: string; status: string };
          seenLogPosts.push({ id: params.id as string, body });
          await delay(200);
          logRows = [
            ...logRows.filter((entry) => !(entry.habit_id === params.id && entry.log_date === body.log_date)),
            { habit_id: params.id as string, log_date: body.log_date, status: body.status },
          ];
          return HttpResponse.json({ id: "log1" }, { status: 201 });
        },
        { once: true },
      ),
    );
    renderPage();
    const grid = await findGrid();
    const kpi = screen.getByRole("region", { name: "COMPLETADOS HOY (DÍA 15)" });
    expect(within(kpi).getByText("0")).toBeInTheDocument();

    fireEvent.click(within(grid).getByRole("button", { name: "Agua, 15 de septiembre: sin registrar" }));

    // The KPI moved before the delayed POST resolved.
    expect(within(kpi).getByText("1")).toBeInTheDocument();
    expect(within(kpi).getByText("/3")).toBeInTheDocument();

    await waitFor(() => expect(seenLogPosts).toHaveLength(1));
    expect(await within(grid).findByRole("button", { name: "Agua, 15 de septiembre: completado" })).toBeInTheDocument();
  });

  it("dims exactly one weekly bar when every weekday shares the same raw value", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    habitRows = [BASE_HABITS[0]];
    logRows = [];
    for (let day = 1; day <= 15; day += 1) {
      logRows.push({ habit_id: "h1", log_date: `2026-09-${String(day).padStart(2, "0")}`, status: "done" });
    }
    renderPage();
    await findGrid();

    const weekly = await screen.findByRole("region", { name: "Consistencia Semanal" });
    expect(weekly.querySelectorAll(".opacity-40")).toHaveLength(1);
  });

  it("archives with confirmation and restores the row from Archivados", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    const grid = await findGrid();

    fireEvent.click(within(grid).getByRole("button", { name: "Acciones de Entrenamiento de fuerza" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archivar" }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    await waitFor(() =>
      expect(within(grid).queryByRole("rowheader", { name: /Entrenamiento de fuerza/ })).toBeNull(),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Archivados (1)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Desarchivar Entrenamiento de fuerza" }));

    expect(await within(grid).findByRole("rowheader", { name: /Entrenamiento de fuerza/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archivados (1)" })).toBeNull();
  });

  it("keeps the row and shows a toast when archiving fails", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    server.use(
      http.patch("http://test.local/api/habits/:id", () => HttpResponse.json({ error: "boom" }, { status: 500 }), {
        once: true,
      }),
    );
    renderPage();
    const grid = await findGrid();

    fireEvent.click(within(grid).getByRole("button", { name: "Acciones de Agua" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archivar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo archivar el hábito.");
    expect(within(grid).getByRole("rowheader", { name: /Agua/ })).toBeInTheDocument();
  });

  it("shows the empty-state CTA when every habit is archived", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    habitRows = BASE_HABITS.map((row) => ({ ...row, is_archived: true }));
    renderPage();

    expect(await screen.findByText("Aún no tienes hábitos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Añadir tu primer hábito" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archivados (4)" })).toBeInTheDocument();
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("renders days before startDate as disabled futuro cells even with a log", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    habitRows = BASE_HABITS.map((row) => (row.id === "h1" ? { ...row, start_date: "2026-09-10" } : { ...row }));
    logRows = [...BASE_LOGS, { habit_id: "h1", log_date: "2026-09-03", status: "done" }];
    renderPage();
    const grid = await findGrid();

    const early = within(grid).getByRole("button", { name: "Entrenamiento de fuerza, 3 de septiembre: futuro" });
    expect(early).toBeDisabled();
    expect(early.className).toContain("bg-black/40");
    expect(early).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(early);
    expect(seenLogPosts).toHaveLength(0);
    expect(seenLogDeletes).toHaveLength(0);

    const inRange = within(grid).getByRole("button", { name: "Entrenamiento de fuerza, 12 de septiembre: sin registrar" });
    expect(inRange).not.toBeDisabled();
  });

  it("reverts an optimistic toggle and shows a toast when the POST fails", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    server.use(
      http.post("http://test.local/api/habits/:id/logs", () => HttpResponse.json({ error: "boom" }, { status: 500 }), {
        once: true,
      }),
    );
    renderPage();
    const grid = await findGrid();

    fireEvent.click(within(grid).getByRole("button", { name: "Agua, 15 de septiembre: sin registrar" }));
    expect(within(grid).getByRole("button", { name: "Agua, 15 de septiembre: completado" })).toBeInTheDocument();

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo actualizar el hábito.");
    expect(await within(grid).findByRole("button", { name: "Agua, 15 de septiembre: sin registrar" })).toBeInTheDocument();
  });

  it("completes an unlogged past cell with POST only, never DELETE", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    renderPage();
    const grid = await findGrid();

    fireEvent.click(within(grid).getByRole("button", { name: "Agua, 3 de septiembre: sin registrar" }));
    await waitFor(() => expect(seenLogPosts).toHaveLength(1));
    expect(seenLogPosts[0]).toEqual({ id: "h2", body: { log_date: "2026-09-03", status: "done" } });
    expect(seenLogDeletes).toHaveLength(0);
  });

  it("revalidates the shared today cache other screens subscribe to", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    render(
      h(
        SWRConfig,
        { value: { provider: () => new Map(), dedupingInterval: 0 } },
        h("div", null, h(TodayProbe, null), h(HabitosPage, null)),
      ),
    );
    const grid = await findGrid();
    await waitFor(() => expect(todayFetches).toBeGreaterThan(0));
    const before = todayFetches;

    fireEvent.click(within(grid).getByRole("button", { name: "Agua, 15 de septiembre: sin registrar" }));
    await waitFor(() => expect(todayFetches).toBeGreaterThan(before));
  });

  it("traps focus in the report modal and restores it to the trigger on close", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    renderPage();
    await findGrid();

    const trigger = await screen.findByRole("button", { name: "Ver reporte detallado →" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Reporte detallado" });
    expect(within(dialog).getByRole("button", { name: "Cerrar" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("pulls focus back into the create modal when it escapes", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Añadir Hábito" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo hábito" });
    const nameInput = within(dialog).getByLabelText("Nombre");
    expect(nameInput).toHaveFocus();

    screen.getByRole("button", { name: "Mes anterior" }).focus();
    expect(nameInput).toHaveFocus();
  });

  it("shows a neutral delta pill when month-over-month compliance does not change", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    habitRows = [BASE_HABITS[0]];
    logRows = [];
    renderPage();
    await findGrid();

    expect(await screen.findByText("= 0%")).toBeInTheDocument();
    expect(screen.queryByText(/↗|↘/)).toBeNull();
  });

  it("labels the best weekday with its full capitalized Spanish name", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    renderPage();
    await findGrid();

    expect(await screen.findByText("Día con mayor rendimiento: Miércoles (13%)")).toBeInTheDocument();
  });

  it("renders the milestone 100% phrase in bold green", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    habitRows = [
      habit({
        id: "h1",
        name: "Entrenamiento de fuerza",
        category: "Salud & Físico",
        short_label: "45m",
        color: "#38BDF8",
        icon: "dumbbell",
      }),
    ];
    logRows = [];
    for (let day = 2; day <= 15; day += 1) {
      logRows.push({ habit_id: "h1", log_date: `2026-09-${String(day).padStart(2, "0")}`, status: "done" });
    }
    renderPage();
    await findGrid();

    expect(await screen.findByText("Dominio de Hábitos de Salud & Físico")).toBeInTheDocument();
    const bold = screen.getByText("100% de consistencia");
    expect(bold.tagName).toBe("STRONG");
    expect(bold.className).toContain("text-[#4ADE80]");
  });
});
