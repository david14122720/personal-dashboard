import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import { EventForm, GoalForm, NoteForm, TaskForm } from "@/components/productivity/ProductivityForms";
import { NotesResults, TasksList, TaskViewTabs } from "@/components/productivity/ProductivitySections";
import {
  createEvent,
  createGoal,
  createNote,
  createTask,
  deleteNote,
  deleteTask,
  updateTask,
  type TaskWire,
} from "@/lib/api/productivity";
import {
  countEventsByTimeView,
  countTasksByDateView,
  filterEventsByTimeView,
  filterTasksByDateView,
  todayYmdLocal,
} from "@/lib/productivity/productivity";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const seenPosts: Array<{ url: string; body: unknown }> = [];
const seenPatches: Array<{ url: string; body: unknown }> = [];
const seenDeletes: string[] = [];

const server = setupServer(
  http.post("http://test.local/api/tasks", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    seenPosts.push({ url: request.url, body });
    return HttpResponse.json(
      {
        id: "t-new",
        title: body["title"],
        description: null,
        priority: body["priority"] ?? "medium",
        status: "pending",
        due_date: body["due_date"] ?? null,
        completed_at: null,
        goal_id: body["goal_id"] ?? null,
        sort_order: 0,
      },
      { status: 201 },
    );
  }),
  http.patch("http://test.local/api/tasks/:id", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    seenPatches.push({ url: request.url, body });
    return HttpResponse.json({
      id: "t1",
      title: body["title"] ?? "Buy shoes",
      description: null,
      priority: body["priority"] ?? "high",
      status: body["status"] ?? "pending",
      due_date: null,
      completed_at: null,
      goal_id: null,
      sort_order: 0,
    });
  }),
  http.delete("http://test.local/api/tasks/:id", ({ request }) => {
    seenDeletes.push(request.url);
    return new HttpResponse(null, { status: 204 });
  }),
  http.post("http://test.local/api/events", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    seenPosts.push({ url: request.url, body });
    return HttpResponse.json(
      {
        id: "e-new",
        title: body["title"],
        description: null,
        kind: body["kind"] ?? "event",
        starts_at: body["starts_at"],
        ends_at: null,
        all_day: false,
        location: body["location"] ?? null,
      },
      { status: 201 },
    );
  }),
  http.post("http://test.local/api/notes", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    seenPosts.push({ url: request.url, body });
    return HttpResponse.json(
      {
        id: "n-new",
        title: body["title"],
        body: body["body"] ?? "",
        is_markdown: true,
        is_pinned: body["is_pinned"] ?? false,
        updated_at: "2026-09-09T10:00:00Z",
      },
      { status: 201 },
    );
  }),
  http.delete("http://test.local/api/notes/:id", ({ request }) => {
    seenDeletes.push(request.url);
    return new HttpResponse(null, { status: 204 });
  }),
  http.post("http://test.local/api/goals", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    seenPosts.push({ url: request.url, body });
    return HttpResponse.json(
      {
        id: "g-new",
        name: body["name"],
        description: body["description"] ?? null,
        area: body["area"],
        start_date: "2026-09-09",
        due_date: body["due_date"] ?? null,
        progress: 0,
        status: "active",
        color: null,
      },
      { status: 201 },
    );
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seenPosts.length = 0;
  seenPatches.length = 0;
  seenDeletes.length = 0;
});
afterAll(() => server.close());

function renderWithSWR(ui: React.ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>,
  );
}

const goals = [
  { id: "g1", name: "Maratón" },
  { id: "g2", name: "Panel" },
];

function taskRow(overrides: Partial<TaskWire> = {}): TaskWire {
  return {
    id: "t1",
    title: "Buy shoes",
    description: null,
    priority: "high",
    status: "pending",
    due_date: null,
    completed_at: null,
    goal_id: null,
    sort_order: 0,
    ...overrides,
  };
}

describe("S2 tareas: crear con meta por nombre y completar", () => {
  it("crea una tarea vía POST /tasks con prioridad, fecha y meta elegida por nombre", async () => {
    renderWithSWR(<TaskForm goals={goals} />);
    const form = await screen.findByRole("form", { name: "Nueva tarea" });
    fireEvent.change(within(form).getByLabelText("Título"), { target: { value: "Comprar zapatos" } });
    fireEvent.change(within(form).getByLabelText("Prioridad"), { target: { value: "high" } });
    fireEvent.change(within(form).getByLabelText("Fecha límite"), { target: { value: "2026-09-10" } });
    fireEvent.change(within(form).getByLabelText("Meta asociada"), { target: { value: "g1" } });
    expect(within(form).getByRole("option", { name: "Maratón" })).toBeInTheDocument();
    expect(within(form).queryByText(/g1/)).not.toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "Crear" }));
    expect(await within(form).findByText("Guardado.")).toBeInTheDocument();
    expect(seenPosts).toHaveLength(1);
    expect(seenPosts[0].url).toContain("/tasks");
    expect(seenPosts[0].body).toMatchObject({
      title: "Comprar zapatos",
      priority: "high",
      due_date: "2026-09-10",
      goal_id: "g1",
    });
  });

  it("completa una tarea vía PATCH con estado completed", async () => {
    const updated = await updateTask("t1", { status: "completed" });
    expect(updated.status).toBe("completed");
    expect(seenPatches[0].url).toContain("/tasks/t1");
    expect(seenPatches[0].body).toMatchObject({ status: "completed" });
  });

  it("elimina una tarea vía DELETE y ofrece editar/eliminar por fila", async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderWithSWR(
      <TasksList
        tasks={[taskRow({ goal_id: "g1" })]}
        togglingId={null}
        onToggle={() => {}}
        goalNameById={{ g1: "Maratón" }}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
    expect(await screen.findByText(/Maratón/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Editar Buy shoes" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Eliminar Buy shoes" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    await deleteTask("t1");
    expect(seenDeletes[0]).toContain("/tasks/t1");
  });
});

describe("S2 vistas de tareas por fecha (Hoy / Vencidas)", () => {
  const rows = [
    taskRow({ id: "today", title: "Hoy", due_date: "2026-09-09" }),
    taskRow({ id: "late", title: "Vencida", due_date: "2026-09-01" }),
    taskRow({ id: "next", title: "Futura", due_date: "2026-09-20" }),
    taskRow({ id: "nodate", title: "Sin fecha", due_date: null }),
    taskRow({ id: "done", title: "Hecha", status: "completed", completed_at: "2026-09-08T10:00:00Z" }),
  ];

  it("clasifica Hoy y Vencidas contra el día local", () => {
    expect(filterTasksByDateView(rows, "today", "2026-09-09").map((t) => t.id)).toEqual(["today"]);
    expect(filterTasksByDateView(rows, "overdue", "2026-09-09").map((t) => t.id)).toEqual(["late"]);
    expect(filterTasksByDateView(rows, "upcoming", "2026-09-09").map((t) => t.id)).toEqual([
      "next",
      "nodate",
    ]);
    expect(filterTasksByDateView(rows, "done", "2026-09-09").map((t) => t.id)).toEqual(["done"]);
    expect(countTasksByDateView(rows, "2026-09-09")).toMatchObject({
      all: 5,
      today: 1,
      overdue: 1,
      upcoming: 2,
      done: 1,
    });
  });

  it("las pestañas muestran conteos y cambian la vista", async () => {
    const onView = vi.fn();
    renderWithSWR(
      <TaskViewTabs
        view="all"
        counts={{ all: 5, today: 1, upcoming: 2, overdue: 1, done: 1 }}
        onView={onView}
      />,
    );
    expect(screen.getByRole("button", { name: "Hoy (1)" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Vencidas (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Todas (5)" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Vencidas (1)" }));
    expect(onView).toHaveBeenCalledWith("overdue");
  });

  it("todayYmdLocal respeta el calendario local", () => {
    expect(todayYmdLocal(new Date(2026, 8, 9, 12, 0, 0))).toBe("2026-09-09");
  });
});

describe("S2 eventos: crear por tipo y vistas próximos/vencidos", () => {
  it("crea un evento vía POST /events con tipo elegido por nombre", async () => {
    renderWithSWR(<EventForm />);
    const form = await screen.findByRole("form", { name: "Nuevo evento" });
    fireEvent.change(within(form).getByLabelText("Título"), { target: { value: "Dentista" } });
    fireEvent.change(within(form).getByLabelText("Fecha y hora"), {
      target: { value: "2026-09-10T10:00" },
    });
    fireEvent.change(within(form).getByLabelText("Tipo"), { target: { value: "appointment" } });
    fireEvent.click(within(form).getByRole("button", { name: "Crear" }));
    expect(await within(form).findByText("Guardado.")).toBeInTheDocument();
    expect(seenPosts[0].url).toContain("/events");
    expect(seenPosts[0].body).toMatchObject({ title: "Dentista", kind: "appointment" });
    expect(seenPosts[0].body).toHaveProperty("starts_at");
  });

  it("separa próximos de vencidos por hora de fin", () => {
    const now = Date.parse("2026-09-09T12:00:00Z");
    const upcoming = { starts_at: "2026-09-10T10:00:00Z", ends_at: null };
    const overdue = { starts_at: "2026-09-01T10:00:00Z", ends_at: null };
    const finished = {
      starts_at: "2026-09-09T10:00:00Z",
      ends_at: "2026-09-09T11:00:00Z",
    };
    expect(filterEventsByTimeView([upcoming, overdue, finished], "upcoming", now)).toEqual([
      upcoming,
    ]);
    expect(
      filterEventsByTimeView([upcoming, overdue, finished], "overdue", now).length,
    ).toBe(2);
    expect(countEventsByTimeView([upcoming, overdue, finished], now)).toMatchObject({
      all: 3,
      upcoming: 1,
      overdue: 2,
    });
  });
});

describe("S2 notas: crear, fijar y eliminar", () => {
  it("crea una nota vía POST /notes con fijada marcada", async () => {
    renderWithSWR(<NoteForm />);
    const form = await screen.findByRole("form", { name: "Nueva nota" });
    fireEvent.change(within(form).getByLabelText("Título"), { target: { value: "Plan" } });
    fireEvent.change(within(form).getByLabelText("Contenido"), { target: { value: "hoja de ruta" } });
    fireEvent.click(within(form).getByLabelText("Fijada"));
    fireEvent.click(within(form).getByRole("button", { name: "Crear" }));
    expect(await within(form).findByText("Guardado.")).toBeInTheDocument();
    expect(seenPosts[0].url).toContain("/notes");
    expect(seenPosts[0].body).toMatchObject({ title: "Plan", is_pinned: true });
  });

  it("ofrece fijar, editar y eliminar por nota sin buscador global", async () => {
    const onTogglePin = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderWithSWR(
      <NotesResults
        notes={[
          {
            id: "n1",
            title: "Plan",
            body: "hoja de ruta",
            is_markdown: true,
            is_pinned: false,
            updated_at: "2026-09-09T10:00:00Z",
          },
        ]}
        onTogglePin={onTogglePin}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
    expect(await screen.findByText("Plan")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fijar Plan" }));
    expect(onTogglePin).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Editar Plan" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Eliminar Plan" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    await deleteNote("n1");
    expect(seenDeletes[0]).toContain("/notes/n1");
  });
});

describe("S2 metas: crear con categoría por selector y progreso visible", () => {
  it("crea una meta vía POST /goals con categoría elegida por nombre", async () => {
    renderWithSWR(<GoalForm />);
    const form = await screen.findByRole("form", { name: "Nueva meta" });
    fireEvent.change(within(form).getByLabelText("Nombre"), {
      target: { value: "Correr una maratón" },
    });
    fireEvent.change(within(form).getByLabelText("Categoría"), { target: { value: "salud" } });
    fireEvent.change(within(form).getByLabelText("Fecha límite"), {
      target: { value: "2026-12-31" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Crear" }));
    expect(await within(form).findByText("Guardado.")).toBeInTheDocument();
    expect(seenPosts[0].url).toContain("/goals");
    expect(seenPosts[0].body).toMatchObject({
      name: "Correr una maratón",
      area: "salud",
      due_date: "2026-12-31",
    });
  });

  it("crea tareas y metas vía helpers sin UUIDs a mano", async () => {
    const goal = await createGoal({ name: "Panel", area: "trabajo" });
    const task = await createTask({ title: "Escribir plan", priority: "medium", goal_id: goal.id });
    expect(task).toMatchObject({ title: "Escribir plan", goal_id: "g-new" });
    const event = await createEvent({ title: "Cita", starts_at: "2026-09-10T10:00:00Z" });
    expect(event).toMatchObject({ title: "Cita" });
    const note = await createNote({ title: "Idea", body: "algo" });
    expect(note).toMatchObject({ title: "Idea" });
    expect(seenPosts.map((p) => p.url)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/goals"),
        expect.stringContaining("/tasks"),
        expect.stringContaining("/events"),
        expect.stringContaining("/notes"),
      ]),
    );
  });
});
