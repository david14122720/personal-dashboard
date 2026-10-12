import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import ProductivityScreens, {
  addDays,
  startOfIsoWeek,
  weekCompletion,
} from "@/components/containers/ProductivityScreens";
import { calendarDateLabel, todayYmdLocal } from "@/lib/productivity/productivity";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

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

const seenTaskPatches: Array<{ taskId: string; body: unknown }> = [];
const seenNotesQueries: string[] = [];

const server = setupServer(
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
  it("does not render a habits section (single owner is /dashboard/habitos/)", async () => {
    renderScreens();
    await screen.findByRole("region", { name: "Metas" });
    expect(screen.queryByRole("region", { name: "Hábitos" })).not.toBeInTheDocument();
    expect(screen.queryByText("calendario-habitos")).not.toBeInTheDocument();
  });

  it("renders goals with auto-derived progress bars and Spanish status", async () => {
    renderScreens();
    const section = await screen.findByRole("region", { name: "Metas" });
    expect(within(section).getByText("Run a marathon")).toBeInTheDocument();
    expect(within(section).getByText("activa")).toBeInTheDocument();
    expect(within(section).getByText("completada")).toBeInTheDocument();
    // Real area chip (as stored), real percentage and the real linked-task count.
    expect(within(section).getByText("health")).toBeInTheDocument();
    expect(within(section).getByText("work")).toBeInTheDocument();
    expect(within(section).getByText("50%")).toBeInTheDocument();
    expect(within(section).getByText("0 de 1 tarea lista")).toBeInTheDocument();
    expect(within(section).getByText("Sin tareas vinculadas")).toBeInTheDocument();
    expect(within(section).getByText("vence 31 dic")).toBeInTheDocument();
    const bar = within(section).getByRole("progressbar", { name: "Progreso de Run a marathon" });
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(within(section).getByRole("progressbar", { name: "Progreso de Ship dashboard" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });

  it("lists tasks with the real pill counts, chips and the checkbox toggle", async () => {
    renderScreens();
    const section = await screen.findByRole("region", { name: "Tareas" });
    expect(await within(section).findByText("Buy shoes")).toBeInTheDocument();
    // Real status/priority chips and the meta line the app can actually build.
    expect(within(section).getByText("alta")).toBeInTheDocument();
    expect(within(section).getByText("pendiente")).toBeInTheDocument();
    expect(within(section).getByText("en curso")).toBeInTheDocument();
    expect(within(section).getByText("completada")).toBeInTheDocument();
    expect(within(section).getByText("Meta: Run a marathon")).toBeInTheDocument();
    expect(within(section).getByText("vence 10 sept")).toBeInTheDocument();
    // Real counts inside every pill (filters switch tested in their own case).
    expect(within(section).getByRole("button", { name: "Todas (3)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(section).getByRole("button", { name: "Completadas (1)" })).toBeInTheDocument();

    // The checkbox is the real toggle (`PATCH /tasks`).
    const toggle = within(section).getByRole("checkbox", { name: "Completar Buy shoes" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
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
    // Real kind chip, the real Bogotá range and the real location when present.
    expect(within(section).getByText("cita")).toBeInTheDocument();
    expect(within(section).getByText("clinic")).toBeInTheDocument();
    expect(within(section).getByText("05:00 – 06:00")).toBeInTheDocument();
    expect(within(section).getByText(/todo el día/)).toBeInTheDocument();
    // Real date block, localized from the real start instant (Bogotá).
    expect(within(section).getAllByText("SEPT")).toHaveLength(2);
    expect(within(section).getByText("10")).toBeInTheDocument();
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
    expect(within(section).getByText("Actualizado 7 de septiembre de 2026")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(section).queryByText("Shopping list")).not.toBeInTheDocument();
    });
    expect(seenNotesQueries.some((q) => q.includes("project"))).toBe(true);
  });

  it("shows empty states when every productivity endpoint returns nothing", async () => {
    server.use(
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

describe("productivity collapsed creation forms", () => {
  it("keeps creation forms collapsed on mount and reveals them via Nuevo", async () => {
    renderScreens();
    const section = await screen.findByRole("region", { name: "Tareas" });
    expect(screen.queryByRole("form", { name: "Nueva tarea" })).not.toBeInTheDocument();
    const nuevo = within(section).getByRole("button", { name: "Nuevo en Tareas" });
    expect(nuevo).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(nuevo);
    expect(await screen.findByRole("form", { name: "Nueva tarea" })).toBeInTheDocument();
    expect(nuevo).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses the form after a successful save", async () => {
    server.use(
      http.post("http://test.local/api/tasks", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          id: "t-new",
          description: null,
          status: "pending",
          due_date: null,
          completed_at: null,
          goal_id: null,
          sort_order: 3,
          ...body,
        });
      }),
    );
    renderScreens();
    const section = await screen.findByRole("region", { name: "Tareas" });
    fireEvent.click(within(section).getByRole("button", { name: "Nuevo en Tareas" }));
    const form = await screen.findByRole("form", { name: "Nueva tarea" });
    fireEvent.change(within(form).getByLabelText("Título"), {
      target: { value: "Nueva tarea e2e" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Crear" }));
    await waitFor(() => {
      expect(screen.queryByRole("form", { name: "Nueva tarea" })).not.toBeInTheDocument();
    });
  });

  it("opens Editar pre-filled and returns to collapsed on cancel", async () => {
    renderScreens();
    const section = await screen.findByRole("region", { name: "Metas" });
    fireEvent.click(within(section).getByRole("button", { name: "Editar Run a marathon" }));
    const form = await screen.findByRole("form", { name: "Editar meta" });
    expect(within(form).getByLabelText("Nombre")).toHaveValue("Run a marathon");
    fireEvent.click(within(form).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => {
      expect(screen.queryByRole("form", { name: "Editar meta" })).not.toBeInTheDocument();
    });
  });

  it("keeps at most one section form open across sections", async () => {
    renderScreens();
    const tasks = await screen.findByRole("region", { name: "Tareas" });
    fireEvent.click(within(tasks).getByRole("button", { name: "Nuevo en Tareas" }));
    expect(await screen.findByRole("form", { name: "Nueva tarea" })).toBeInTheDocument();
    const notes = await screen.findByRole("region", { name: "Notas" });
    fireEvent.click(within(notes).getByRole("button", { name: "Nuevo en Notas" }));
    expect(await screen.findByRole("form", { name: "Nueva nota" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Nueva tarea" })).not.toBeInTheDocument();
  });

  it("still offers Nuevo when a section list is empty", async () => {
    server.use(http.get("http://test.local/api/goals", () => HttpResponse.json([])));
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ProductivityScreens />
      </SWRConfig>,
    );
    const section = await screen.findByRole("region", { name: "Metas" });
    expect(await within(section).findByText("Sin metas aún")).toBeInTheDocument();
    const control = within(section).getByRole("button", { name: "Nueva meta" });
    expect(control).toHaveTextContent("Nueva");
  });

  it("toggles aria-expanded on the Nuevo control", async () => {
    renderScreens();
    const section = await screen.findByRole("region", { name: "Eventos" });
    const nuevo = within(section).getByRole("button", { name: "Nuevo en Eventos" });
    expect(nuevo).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(nuevo);
    expect(nuevo).toHaveAttribute("aria-expanded", "true");
    expect(nuevo).toHaveAttribute("aria-controls", "productivity-form-events");
    fireEvent.click(nuevo);
    expect(nuevo).toHaveAttribute("aria-expanded", "false");
  });
});

describe("productivity content cards (T5b)", () => {
  it("keeps the header and section Nuevo controls on one aria-synced state machine", async () => {
    renderScreens();
    const goals = await screen.findByRole("region", { name: "Metas" });
    const headerGoal = screen.getByRole("button", { name: "+ Meta" });
    const sectionGoal = within(goals).getByRole("button", { name: "Nueva meta" });
    expect(headerGoal).toHaveAttribute("aria-expanded", "false");
    expect(sectionGoal).toHaveAttribute("aria-expanded", "false");
    expect(headerGoal).toHaveAttribute("aria-controls", "productivity-form-goals");
    expect(sectionGoal).toHaveAttribute("aria-controls", "productivity-form-goals");

    fireEvent.click(headerGoal);
    expect(await screen.findByRole("form", { name: "Nueva meta" })).toBeInTheDocument();
    expect(headerGoal).toHaveAttribute("aria-expanded", "true");
    expect(sectionGoal).toHaveAttribute("aria-expanded", "true");

    // A second control (this time a section one) closes the first panel.
    const events = screen.getByRole("region", { name: "Eventos" });
    const sectionEvent = within(events).getByRole("button", { name: "Nuevo en Eventos" });
    fireEvent.click(sectionEvent);
    expect(await screen.findByRole("form", { name: "Nuevo evento" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Nueva meta" })).not.toBeInTheDocument();
    expect(headerGoal).toHaveAttribute("aria-expanded", "false");
    expect(sectionGoal).toHaveAttribute("aria-expanded", "false");
    expect(sectionEvent).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "+ Evento" })).toHaveAttribute("aria-expanded", "true");
  });

  it("never renders the prototype's fabricated card copy or figures (D10)", async () => {
    renderScreens();
    await screen.findByRole("region", { name: "Metas" });
    const grid = document.querySelector(".grid.grid-cols-12");
    if (!grid) throw new Error("sections grid missing");
    for (const fabricated of [
      "75%",
      "90%",
      "6 de 8 tareas listas",
      "3 hábitos sincronizados",
      "Racha de 14 días",
      "Vincular tareas",
      "Vincular hábitos",
      "Ver desglose",
      "Alta prioridad",
      "Enlace virtual activo",
      "Actualizado hace 3 horas",
      "SERVER_HOST=192.168.50.120:8055",
      "Sprint 3/4",
    ]) {
      expect(within(grid as HTMLElement).queryByText(fabricated), fabricated).not.toBeInTheDocument();
    }
  });

  it("filters the events card by Hoy / Próximos / Vencidos with real counts", async () => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const hours = (n: number): string => new Date(startOfToday.getTime() + n * 3_600_000).toISOString();
    server.use(
      http.get("http://test.local/api/events", () =>
        HttpResponse.json([
          {
            id: "past",
            title: "Ya pasó",
            description: null,
            kind: "event",
            starts_at: hours(-25),
            ends_at: hours(-24),
            all_day: false,
            location: null,
          },
          {
            id: "soon",
            title: "Más tarde",
            description: null,
            kind: "event",
            starts_at: hours(1),
            ends_at: hours(24),
            all_day: false,
            location: "Sala",
          },
          {
            id: "later",
            title: "Próxima semana",
            description: null,
            kind: "event",
            starts_at: hours(49),
            ends_at: null,
            all_day: false,
            location: null,
          },
        ]),
      ),
    );
    renderScreens();
    const section = await screen.findByRole("region", { name: "Eventos" });
    expect(within(section).getByRole("button", { name: "Todos (3)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(section).getByRole("button", { name: "Hoy (1)" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Próximos (1)" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Vencidos (1)" })).toBeInTheDocument();

    fireEvent.click(within(section).getByRole("button", { name: "Hoy (1)" }));
    expect(within(section).getByText("Más tarde")).toBeInTheDocument();
    expect(within(section).queryByText("Ya pasó")).not.toBeInTheDocument();
    expect(within(section).queryByText("Próxima semana")).not.toBeInTheDocument();

    fireEvent.click(within(section).getByRole("button", { name: "Vencidos (1)" }));
    expect(within(section).getByText("Ya pasó")).toBeInTheDocument();
    expect(within(section).queryByText("Más tarde")).not.toBeInTheDocument();

    fireEvent.click(within(section).getByRole("button", { name: "Próximos (1)" }));
    expect(within(section).getByText("Próxima semana")).toBeInTheDocument();
    expect(within(section).queryByText("Ya pasó")).not.toBeInTheDocument();
  });

  it("filters the tasks card and states a zero-count pill honestly", async () => {
    const today = todayYmdLocal();
    server.use(
      http.get("http://test.local/api/tasks", () =>
        HttpResponse.json([
          { ...tasks[0], id: "td", title: "Tarea de hoy", due_date: today, goal_id: null },
          { ...tasks[0], id: "tf", title: "Tarea futura", due_date: "2999-01-01", goal_id: null },
        ]),
      ),
    );
    renderScreens();
    const section = await screen.findByRole("region", { name: "Tareas" });
    expect(await within(section).findByText("Tarea de hoy")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Hoy (1)" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Vencidas (0)" })).toBeInTheDocument();
    fireEvent.click(within(section).getByRole("button", { name: "Vencidas (0)" }));
    expect(within(section).getByText("Sin tareas en esta vista.")).toBeInTheDocument();
    expect(within(section).queryByText("Tarea de hoy")).not.toBeInTheDocument();
  });

  it("shows the real note footer actions and never invents a snippet", async () => {
    renderScreens();
    const section = await screen.findByRole("region", { name: "Notas" });
    expect(await within(section).findByText("Shopping list")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Fijar Shopping list" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Editar Shopping list" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Eliminar Shopping list" })).toBeInTheDocument();
    // No `Copiar` / monospace block: the wire has no snippet marker (D10).
    expect(within(section).queryByText("Copiar")).not.toBeInTheDocument();
    expect(section.querySelector("code")).toBeNull();
  });
});

describe("productivity module header (T5a)", () => {
  it("renders the title, the focus chip, the real subtitle and the action row", async () => {
    renderScreens();
    await screen.findByRole("region", { name: "Metas" });
    expect(screen.getByRole("heading", { name: "Productividad" })).toBeInTheDocument();
    expect(screen.getByText("Modo enfoque")).toBeInTheDocument();
    expect(screen.getByText("Hábitos, metas, tareas, eventos y notas.")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Ver calendario expandido" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "productivity-calendar-panel");
    // The app's real creation entry points, mirrored in the header row.
    expect(screen.getByRole("button", { name: "+ Meta" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Evento" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Nota" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Nueva tarea" })).toBeInTheDocument();
  });

  it("claims En sincronía only after every read resolved", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("http://test.local/api/goals", async () => {
        await gate;
        return HttpResponse.json(goals);
      }),
    );
    renderScreens();
    expect(screen.getByText("Sincronizando")).toBeInTheDocument();
    expect(screen.queryByText("En sincronía")).not.toBeInTheDocument();
    release();
    expect(await screen.findByText("En sincronía")).toBeInTheDocument();
    expect(screen.queryByText("Sincronizando")).not.toBeInTheDocument();
  });

  it("never claims En sincronía while a read is failing", async () => {
    server.use(http.get("http://test.local/api/goals", () => HttpResponse.error()));
    render(
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        <ProductivityScreens />
      </SWRConfig>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudieron cargar las secciones de productividad",
    );
    expect(screen.queryByText("En sincronía")).not.toBeInTheDocument();
    expect(screen.queryByText("Sincronizando")).not.toBeInTheDocument();
    // No dead creation action while the sections do not exist.
    expect(screen.queryByRole("button", { name: "+ Meta" })).not.toBeInTheDocument();
  });

  it("opens and collapses one creation form from the header action row", async () => {
    renderScreens();
    await screen.findByRole("region", { name: "Metas" });
    const meta = screen.getByRole("button", { name: "+ Meta" });
    fireEvent.click(meta);
    expect(await screen.findByRole("form", { name: "Nueva meta" })).toBeInTheDocument();
    fireEvent.click(meta);
    await waitFor(() => {
      expect(screen.queryByRole("form", { name: "Nueva meta" })).not.toBeInTheDocument();
    });
  });
});

/** KPI tiles are `<article>`s: find the one under a given label. */
function kpiTile(label: string): HTMLElement {
  const tile = screen.getByText(label).closest("article");
  if (!tile) throw new Error(`No KPI tile for ${label}`);
  return tile as HTMLElement;
}

describe("productivity KPI row (T5a, real data only)", () => {
  // This block pins the clock; without it the fixtures were anchored on the
  // current instant and the events list silently fell out of "today" on any
  // run after ~21:00 local.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("recomputes every figure from the live reads", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T15:00:00-05:00"));
    const monday = startOfIsoWeek(todayYmdLocal());
    const wednesday = addDays(monday, 2);
    const lastWeekMonday = addDays(monday, -7);
    const atHour = (h: number): string => {
      const anchor = new Date();
      anchor.setHours(h, 0, 0, 0);
      return anchor.toISOString();
    };
    server.use(
      http.get("http://test.local/api/tasks", () =>
        HttpResponse.json([
          { ...tasks[0], id: "k1", title: "Cerrada esta semana", status: "completed", completed_at: `${wednesday}T10:00:00Z`, due_date: wednesday, goal_id: null, priority: "low" },
          { ...tasks[0], id: "k2", title: "Urgente esta semana", status: "pending", completed_at: null, due_date: wednesday, goal_id: null, priority: "urgent" },
          { ...tasks[0], id: "k3", title: "Pendiente A la semana pasada", status: "pending", completed_at: null, due_date: lastWeekMonday, goal_id: null, priority: "low" },
          { ...tasks[0], id: "k4", title: "Pendiente la semana pasada", status: "pending", completed_at: null, due_date: lastWeekMonday, goal_id: null, priority: "medium" },
        ]),
      ),
      http.get("http://test.local/api/goals", () =>
        HttpResponse.json([
          { ...goals[0], id: "g1", status: "active", progress: 40 },
          { ...goals[0], id: "g2", status: "active", progress: 80 },
          { ...goals[1], id: "g3", status: "completed", progress: 100 },
        ]),
      ),
      http.get("http://test.local/api/events", () =>
        HttpResponse.json([
          {
            id: "e-today",
            title: "Revisión técnica",
            description: null,
            kind: "appointment",
            starts_at: atHour(16),
            ends_at: atHour(17.5),
            all_day: false,
            location: null,
          },
          {
            id: "e-allday",
            title: "Jornada completa",
            description: null,
            kind: "event",
            starts_at: atHour(18),
            ends_at: null,
            all_day: true,
            location: null,
          },
        ]),
      ),
    );
    renderScreens();
    const kpis = await screen.findByRole("region", { name: "Métricas de productividad" });

    // 1/2 dated tasks closed this week, 0/2 the week before: 50% (+50 pts).
    const compliance = kpiTile("Tasa de cumplimiento");
    expect(within(compliance).getByText("50%")).toBeInTheDocument();
    expect(within(compliance).getByText("+50 pts")).toBeInTheDocument();
    expect(within(compliance).getByText(/Tareas con fecha de esta semana: 1 de 2/)).toBeInTheDocument();
    expect(within(compliance).getByText(/vs semana anterior \(0%\)/)).toBeInTheDocument();
    expect(within(compliance).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");

    const active = kpiTile("Tareas activas");
    expect(within(active).getByText("3")).toBeInTheDocument();
    expect(within(active).getByText("sin completar")).toBeInTheDocument();
    expect(within(active).getByText("1 urgente")).toBeInTheDocument();
    expect(within(active).getByText("1 cerrada esta semana")).toBeInTheDocument();

    const goalsTile = kpiTile("Metas en curso");
    expect(within(goalsTile).getByText("2")).toBeInTheDocument();
    expect(within(goalsTile).getByText("activas")).toBeInTheDocument();
    expect(within(goalsTile).getByText("60% de progreso general")).toBeInTheDocument();
    expect(within(goalsTile).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");

    const eventsTile = kpiTile("Eventos de hoy");
    expect(within(eventsTile).getByText("2")).toBeInTheDocument();
    expect(within(eventsTile).getByText("programados")).toBeInTheDocument();
    expect(within(eventsTile).getByText("Revisión técnica")).toBeInTheDocument();
    expect(within(eventsTile).getByText("todo el día")).toBeInTheDocument();

    // D10: the prototype's fabricated figures never render.
    for (const fabricated of [
      "82%",
      "+7.4%",
      "74.6%",
      "12 pendientes",
      "4 urgentes",
      "8 regulares",
      "8 cerradas esta semana",
      "3 metas",
      "68%",
      "2 eventos",
    ]) {
      expect(within(kpis).queryByText(fabricated), fabricated).not.toBeInTheDocument();
    }
  });

  it("states the honest basis when the windows hold no data", async () => {
    server.use(
      http.get("http://test.local/api/tasks", () => HttpResponse.json([])),
      http.get("http://test.local/api/goals", () => HttpResponse.json([])),
      http.get("http://test.local/api/events", () => HttpResponse.json([])),
    );
    renderScreens();
    await screen.findByRole("region", { name: "Métricas de productividad" });
    const compliance = kpiTile("Tasa de cumplimiento");
    expect(within(compliance).getByText("—")).toBeInTheDocument();
    expect(within(compliance).getByText("Sin tareas con fecha esta semana")).toBeInTheDocument();
    expect(within(compliance).queryByRole("progressbar")).not.toBeInTheDocument();
    const goalsTile = kpiTile("Metas en curso");
    expect(within(goalsTile).getByText("0")).toBeInTheDocument();
    expect(within(goalsTile).getByText("Sin metas activas")).toBeInTheDocument();
    expect(within(goalsTile).queryByRole("progressbar")).not.toBeInTheDocument();
    const eventsTile = kpiTile("Eventos de hoy");
    expect(within(eventsTile).getByText("0")).toBeInTheDocument();
    expect(within(eventsTile).getByText("Sin eventos programados hoy")).toBeInTheDocument();
  });

  it("omits the delta chip when the previous week has no dated task", async () => {    const monday = startOfIsoWeek(todayYmdLocal());
    const tuesday = addDays(monday, 1);
    server.use(
      http.get("http://test.local/api/tasks", () =>
        HttpResponse.json([
          { ...tasks[0], id: "s1", status: "completed", completed_at: `${tuesday}T10:00:00Z`, due_date: tuesday, goal_id: null },
        ]),
      ),
    );
    renderScreens();
    await screen.findByRole("region", { name: "Métricas de productividad" });
    const compliance = kpiTile("Tasa de cumplimiento");
    expect(within(compliance).getByText("100%")).toBeInTheDocument();
    expect(within(compliance).queryByText(/pts/)).not.toBeInTheDocument();
    expect(within(compliance).getByText(/sin datos de la semana anterior/)).toBeInTheDocument();
  });

  it("shows the next real events under their own date once today's have ended", async () => {
    const ended = {
      id: "e-ended",
      title: "Ya terminó",
      description: null,
      kind: "event",
      starts_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      ends_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      all_day: false,
      location: null,
    };
    const next = {
      id: "e-next",
      title: "Cita médica",
      description: null,
      kind: "appointment",
      starts_at: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
      ends_at: null,
      all_day: false,
      location: null,
    };
    server.use(
      http.get("http://test.local/api/events", ({ request }) => {
        const url = new URL(request.url);
        // The two-bound KPI read carries `to`; the one-sided section read does not.
        return HttpResponse.json(url.searchParams.has("to") ? [ended] : [next]);
      }),
    );
    renderScreens();
    await screen.findByRole("region", { name: "Métricas de productividad" });
    const eventsTile = kpiTile("Eventos de hoy");
    expect(within(eventsTile).getByText("1")).toBeInTheDocument();
    expect(within(eventsTile).getByText("Cita médica")).toBeInTheDocument();
    expect(within(eventsTile).getByText(/\d{2}:\d{2}$/)).toBeInTheDocument();
    expect(within(eventsTile).getByText("Los eventos de hoy ya terminaron")).toBeInTheDocument();
  });
});

describe("productivity week math (T5a)", () => {
  it("starts the ISO week on Monday and shifts days safely", () => {
    expect(startOfIsoWeek("2026-10-11")).toBe("2026-10-05");
    expect(startOfIsoWeek("2026-10-05")).toBe("2026-10-05");
    expect(addDays("2026-10-05", -3)).toBe("2026-10-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("computes a weekly rate and never invents one for an empty window", () => {
    const rows = [
      { due_date: "2026-10-06", status: "completed", completed_at: "2026-10-06T10:00:00Z" },
      { due_date: "2026-10-07", status: "pending", completed_at: null },
      { due_date: "2026-09-30", status: "completed", completed_at: "2026-09-30T10:00:00Z" },
      { due_date: null, status: "completed", completed_at: "2026-10-10T10:00:00Z" },
    ];
    expect(weekCompletion(rows, "2026-10-05", "2026-10-11")).toEqual({ done: 1, total: 2, pct: 50 });
    expect(weekCompletion(rows, "2026-01-05", "2026-01-11")).toEqual({ done: 0, total: 0, pct: null });
  });
});

describe("productivity calendar mount (T5a)", () => {
  it("keeps the calendar collapsed, above the KPI row and out of the sections grid", async () => {
    renderScreens();
    await screen.findByRole("region", { name: "Metas" });
    const trigger = screen.getByRole("button", { name: "Ver calendario expandido" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    // The internal `Calendario` disclosure is gone: the header owns the toggle.
    expect(screen.queryByRole("heading", { name: "Calendario" })).not.toBeInTheDocument();
    const panel = document.getElementById("productivity-calendar-panel");
    if (!panel) throw new Error("calendar panel missing");
    expect(panel).toHaveAttribute("hidden");
    const kpis = screen.getByRole("region", { name: "Métricas de productividad" });
    expect(panel.compareDocumentPosition(kpis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The 12-column grid now holds exactly the four sections (T5b restyles them).
    const sectionGrid = document.querySelector(".grid.grid-cols-12");
    expect(sectionGrid).not.toBeNull();
    expect(sectionGrid?.children.length).toBe(4);
    expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual([
      "Métricas de productividad",
      "Metas",
      "Eventos",
      "Tareas",
      "Notas",
    ]);
  });

  it("opens the calendar from the header and reveals a day's tasks and events", async () => {
    const due = `${todayYmdLocal().slice(0, 7)}-10`;
    server.use(
      http.get("http://test.local/api/tasks", () =>
        HttpResponse.json([{ ...tasks[0], id: "t-cal", title: "Tarea del calendario", due_date: due }]),
      ),
      http.get("http://test.local/api/events", () =>
        HttpResponse.json([
          {
            id: "e-cal",
            title: "Evento del calendario",
            description: null,
            kind: "event",
            starts_at: new Date(`${due}T10:00:00`).toISOString(),
            ends_at: new Date(`${due}T11:00:00`).toISOString(),
            all_day: false,
            location: null,
          },
        ]),
      ),
    );
    renderScreens();
    await screen.findByRole("region", { name: "Tareas" });
    const trigger = screen.getByRole("button", { name: "Ver calendario expandido" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const grid = await screen.findByRole("grid");
    const label = calendarDateLabel(due);
    const cell = within(grid)
      .getAllByRole("gridcell")
      .find((node) => node.getAttribute("aria-label")?.includes(label));
    expect(cell).toBeDefined();
    await waitFor(() => {
      expect(cell?.querySelector('[data-marker="task"]')).not.toBeNull();
      expect(cell?.querySelector('[data-marker="event"]')).not.toBeNull();
    });
    fireEvent.click(cell as HTMLElement);
    const detail = await screen.findByRole("region", { name: /Detalle de/ });
    expect(within(detail).getByText("Tarea del calendario")).toBeInTheDocument();
    expect(within(detail).getByText("Evento del calendario")).toBeInTheDocument();
    // The same header control collapses it again.
    fireEvent.click(screen.getByRole("button", { name: "Ocultar calendario" }));
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver calendario expandido" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("keeps a KPI skeleton and the four section placeholders while loading", async () => {
    server.use(
      http.get("http://test.local/api/goals", async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json(goals);
      }),
    );
    renderScreens();
    const kpiSkeleton = screen.getByRole("status", { name: "Cargando métricas de productividad" });
    expect(kpiSkeleton.querySelectorAll(".animate-pulse")).toHaveLength(4);
    const status = screen.getByRole("status", { name: "Cargando secciones de productividad" });
    const placeholders = status.querySelectorAll(".animate-pulse");
    expect(placeholders).toHaveLength(4);
    expect(placeholders[0].className).toContain("col-span-12");
    await screen.findByRole("region", { name: "Metas" });
  });
});
