import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import ProductivityScreens from "@/components/containers/ProductivityScreens";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const habitsToday = [
  {
    habit_id: "h1",
    name: "Morning Run",
    habit_frequency: "daily",
    days_of_week: [],
    current_streak: 5,
    today_status: "done",
  },
  {
    habit_id: "h2",
    name: "Read",
    habit_frequency: "daily",
    days_of_week: [],
    current_streak: 0,
    today_status: "pending",
  },
];

const goals = [
  {
    id: "g1",
    name: "Run a marathon",
    description: "train weekly",
    area: "health",
    start_date: "2026-09-01",
    due_date: "2026-12-31",
    progress: 50,
    status: "active",
    color: null,
  },
  {
    id: "g2",
    name: "Ship dashboard",
    description: null,
    area: "work",
    start_date: "2026-09-01",
    due_date: null,
    progress: 100,
    status: "completed",
    color: null,
  },
];

const tasks = [
  {
    id: "t1",
    title: "Buy shoes",
    description: null,
    priority: "high",
    status: "pending",
    due_date: "2026-09-10",
    completed_at: null,
    goal_id: "g1",
    sort_order: 0,
  },
  {
    id: "t2",
    title: "Write plan",
    description: null,
    priority: "medium",
    status: "in_progress",
    due_date: null,
    completed_at: null,
    goal_id: null,
    sort_order: 1,
  },
  {
    id: "t3",
    title: "Old chore",
    description: null,
    priority: "low",
    status: "completed",
    due_date: null,
    completed_at: "2026-09-06T10:00:00Z",
    goal_id: null,
    sort_order: 2,
  },
];

const events = [
  {
    id: "e1",
    title: "Dentist",
    description: null,
    kind: "appointment",
    starts_at: "2026-09-10T10:00:00Z",
    ends_at: "2026-09-10T11:00:00Z",
    all_day: false,
    location: "clinic",
  },
  {
    id: "e2",
    title: "Pay rent",
    description: null,
    kind: "payment_due",
    starts_at: "2026-09-12T00:00:00Z",
    ends_at: null,
    all_day: true,
    location: null,
  },
];

const notesAll = [
  {
    id: "n1",
    title: "Project plan",
    body: "quarterly roadmap for the dashboard",
    is_markdown: true,
    is_pinned: true,
    updated_at: "2026-09-07T10:00:00Z",
  },
  {
    id: "n2",
    title: "Shopping list",
    body: "milk and eggs",
    is_markdown: true,
    is_pinned: false,
    updated_at: "2026-09-06T10:00:00Z",
  },
];

const seenLogPosts: Array<{ habitId: string; body: unknown }> = [];
const seenTaskPatches: Array<{ taskId: string; body: unknown }> = [];
const seenNotesQueries: string[] = [];

const server = setupServer(
  http.get("http://test.local/api/habits/today", () => HttpResponse.json(habitsToday)),
  http.post("http://test.local/api/habits/:id/logs", async ({ params, request }) => {
    seenLogPosts.push({ habitId: params.id as string, body: await request.json() });
    return HttpResponse.json({ id: "l1" }, { status: 201 });
  }),
  http.patch("http://test.local/api/habits/:id/logs/:date", () => HttpResponse.json({ id: "l1" })),
  http.get("http://test.local/api/habits/logs", () => HttpResponse.json([])),
  http.get("http://test.local/api/goals", () => HttpResponse.json(goals)),
  http.get("http://test.local/api/tasks", () => HttpResponse.json(tasks)),
  http.patch("http://test.local/api/tasks/:id", async ({ params, request }) => {
    const body = (await request.json()) as { status: string };
    seenTaskPatches.push({ taskId: params.id as string, body });
    const task = tasks.find((t) => t.id === params.id) ?? tasks[0];
    return HttpResponse.json({ ...task, status: body.status });
  }),
  http.get("http://test.local/api/events", () => HttpResponse.json(events)),
  http.get("http://test.local/api/notes/search", ({ request }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    seenNotesQueries.push(q);
    if (q.toLowerCase().includes("project")) return HttpResponse.json([notesAll[0]]);
    return HttpResponse.json(notesAll);
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seenLogPosts.length = 0;
  seenTaskPatches.length = 0;
  seenNotesQueries.length = 0;
});
afterAll(() => server.close());

function renderScreens() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ProductivityScreens />
    </SWRConfig>,
  );
}

describe("productivity screens", () => {
  it("renders habits with streak counts and LED status but no streak-derived heatmap", async () => {
    renderScreens();
    const habits = await screen.findByRole("region", { name: "Hábitos" });
    expect(within(habits).getAllByText("Morning Run").length).toBeGreaterThanOrEqual(1);
    expect(within(habits).getByText("racha de 5 días · hecho")).toBeInTheDocument();
    expect(within(habits).getByRole("img", { name: "Morning Run, estado hecho" })).toHaveClass("bg-flow");
    expect(
      within(habits).queryByRole("img", { name: "Morning Run recent completions" }),
    ).not.toBeInTheDocument();
    expect(within(habits).getByText("racha de 0 días · pendiente")).toBeInTheDocument();
  });

  it("renders the real-log history section in the calendario-habitos slot", async () => {
    renderScreens();
    const habits = await screen.findByRole("region", { name: "Hábitos" });
    const history = within(habits).getByRole("region", { name: "Historial" });
    expect(within(history).getByRole("combobox", { name: "Hábito" })).toHaveTextContent("Morning Run");
    expect(history.textContent).not.toContain("h1");
    expect(await within(history).findByText("Sin registros en este período", {}, { timeout: 8000 })).toBeInTheDocument();
  });
  it("logs a habit as done through POST with today's date", async () => {
    renderScreens();
    const habits = await screen.findByRole("region", { name: "Hábitos" });
    fireEvent.click(within(habits).getByRole("button", { name: "Registrar Read como hecho" }));
    await waitFor(() => {
      expect(seenLogPosts).toHaveLength(1);
    });
    expect(seenLogPosts[0].habitId).toBe("h2");
    const body = seenLogPosts[0].body as { log_date: string; status: string };
    expect(body.status).toBe("done");
    expect(body.log_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("renders goals with auto-derived progress bars and Spanish status", async () => {
    renderScreens();
    const section = await screen.findByRole("region", { name: "Metas" });
    expect(within(section).getByText("Run a marathon")).toBeInTheDocument();
    expect(within(section).getByText("activa")).toBeInTheDocument();
    expect(within(section).getByText("completada")).toBeInTheDocument();
    const bar = within(section).getByRole("progressbar", { name: "Progreso de Run a marathon" });
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(within(section).getByRole("progressbar", { name: "Progreso de Ship dashboard" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });

  it("groups tasks by status and toggles completion through PATCH", async () => {
    renderScreens();
    const section = await screen.findByRole("region", { name: "Tareas" });
    expect(await within(section).findByText("Buy shoes")).toBeInTheDocument();
    expect(within(section).getByText("alta · vence 2026-09-10")).toBeInTheDocument();
    expect(within(section).getByText("pendiente · 1")).toBeInTheDocument();
    expect(within(section).getByText("en curso · 1")).toBeInTheDocument();
    expect(within(section).getByText("completada · 1")).toBeInTheDocument();

    fireEvent.click(within(section).getByRole("button", { name: "Completar Buy shoes" }));
    await waitFor(() => {
      expect(seenTaskPatches).toHaveLength(1);
    });
    expect(seenTaskPatches[0].taskId).toBe("t1");
    expect((seenTaskPatches[0].body as { status: string }).status).toBe("completed");
  });

  it("renders the upcoming events list compactly in Spanish", async () => {
    renderScreens();
    const section = await screen.findByRole("region", { name: "Eventos" });
    expect(await within(section).findByText("Dentist")).toBeInTheDocument();
    expect(within(section).getByText("Pay rent")).toBeInTheDocument();
    expect(within(section).getByText(/cita · clinic/)).toBeInTheDocument();
    expect(within(section).getByText(/todo el día/)).toBeInTheDocument();
  });

  it("debounces the notes search before hitting the FTS endpoint", async () => {
    renderScreens();
    const section = await screen.findByRole("region", { name: "Notas" });
    expect(await within(section).findByText("Shopping list")).toBeInTheDocument();

    seenNotesQueries.length = 0;
    fireEvent.change(within(section).getByRole("searchbox", { name: "Buscar notas" }), {
      target: { value: "project" },
    });
    expect(await within(section).findByText("Project plan")).toBeInTheDocument();
    expect(within(section).getByText("fijada")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(section).queryByText("Shopping list")).not.toBeInTheDocument();
    });
    expect(seenNotesQueries.some((q) => q.includes("project"))).toBe(true);
  });

  it("shows empty states when every productivity endpoint returns nothing", async () => {
    server.use(
      http.get("http://test.local/api/habits/today", () => HttpResponse.json([])),
      http.get("http://test.local/api/goals", () => HttpResponse.json([])),
      http.get("http://test.local/api/tasks", () => HttpResponse.json([])),
      http.get("http://test.local/api/events", () => HttpResponse.json([])),
      http.get("http://test.local/api/notes/search", () => HttpResponse.json([])),
    );
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ProductivityScreens />
      </SWRConfig>,
    );
    expect(await screen.findByText("Sin hábitos aún")).toBeInTheDocument();
    expect(await screen.findByText("Sin metas aún")).toBeInTheDocument();
    expect(await screen.findByText("Sin tareas aún")).toBeInTheDocument();
    expect(await screen.findByText("Sin próximos eventos")).toBeInTheDocument();
    expect(await screen.findByText("Sin notas")).toBeInTheDocument();
  });

  it("shows an error alert with retry when productivity reads fail", async () => {
    server.use(http.get("http://test.local/api/goals", () => HttpResponse.error()));
    render(
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        <ProductivityScreens />
      </SWRConfig>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar las secciones de productividad");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});
