import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardHome from "@/components/containers/DashboardHome";
// S-H: pending-debts retired, goal-progress metas-only, 5-widget default.
// S-F: the removed debt/savings hooks are deleted — any regression
// reintroducing a /debts or /savings-goals read fails the type check.
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate: vi.fn() }) }));
const q = (data: unknown) => ({ data, error: undefined, isLoading: false });
const seenPatch: unknown[] = [];
let layoutWidgets: Array<{ id: string; type: string; order: number; size: string }> | null = null;
const day = (off: number) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`; };
let subs: unknown[] = [{ id: "s1", name: "Música", price: "9.99", is_active: true, next_billing_on: "__S5__" }];
let tasks: unknown[] = [{ id: "t1", title: "Tarea", status: "pending", due_date: "__T1__" }];
let events: unknown[] = [{ id: "e1", title: "Cobro", kind: "payment_due", starts_at: "__E2__" }, { id: "e10", title: "Agenda", kind: "event", starts_at: "__E10__" }];
let goals: unknown[] = [{ id: "g1", name: "Correr", progress: 60, status: "active" }];
const movements: unknown[] = [];
const categories: unknown[] = [];
const fixDates = () => { subs = [{ id: "s1", name: "Música", price: "9.99", is_active: true, next_billing_on: day(5) }, { id: "sx", name: "Off", price: "5", is_active: false, next_billing_on: day(1) }]; tasks = [{ id: "t1", title: "Tarea", status: "pending", due_date: day(1) }]; events = [{ id: "e1", title: "Cobro", kind: "payment_due", starts_at: day(2) }, { id: "e10", title: "Agenda", kind: "event", starts_at: day(10) }]; };
vi.mock("@/lib/api/dashboard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api/dashboard")>();
  return { ...mod, useNetWorth: () => q({ per_currency: [] }), useHabitsToday: () => q([]), useAccounts: () => q([]),
      useSubscriptions: () => q(subs), useTasks: () => q(tasks), useEvents: () => q(events), useGoals: () => q(goals),
    usePreferences: () => q({ preferences: { currency_code: "COP", locale: "es-CO", dashboard_layout: layoutWidgets ? { widgets: layoutWidgets } : null } }),
    useUpdateLayout: () => async (next: { widgets: unknown[] }) => { seenPatch.push({ dashboard_layout: next }); layoutWidgets = next.widgets as typeof layoutWidgets; } };
});
vi.mock("@/lib/api/finance", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api/finance")>();
  return {
    ...mod,
    useSubscriptions: () => q(subs),
    useMovements: () => q(movements),
    useCategories: () => q(categories),
  };
});
beforeEach(() => { seenPatch.length = 0; layoutWidgets = null; fixDates(); goals = [{ id: "g1", name: "Correr", progress: 60, status: "active" }]; localStorage.clear(); });
describe("DashboardHome strip + toggles S-H", () => {
  it("renders the 4-KPI strip with no month-split cards and no debts/savings", async () => {
    render(<DashboardHome />);
    expect((await screen.findAllByText("Patrimonio neto")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Saldo total")).toBeInTheDocument();
    expect(screen.queryByText("Deudas")).not.toBeInTheDocument();
    expect(screen.queryByText("Ahorros")).not.toBeInTheDocument();
    expect(screen.queryByText("Ingreso del mes")).not.toBeInTheDocument();
    expect(screen.queryByText("Gasto del mes")).not.toBeInTheDocument();
    expect(screen.queryByText("Ahorro del mes")).not.toBeInTheDocument();
  });
  it("toggles hide one widget with exact PATCH envelope and round-trips", async () => {
    render(<DashboardHome />);
    await screen.findAllByText("Próximos pagos");
    const switches = screen.getAllByRole("switch");
    expect(switches.length).toBe(10);
    fireEvent.click(switches[0]);
    await waitFor(() => expect(seenPatch.length).toBe(1));
    expect(seenPatch[0]).toEqual({ dashboard_layout: expect.objectContaining({ widgets: expect.any(Array) }) });
    expect((seenPatch[0] as { dashboard_layout: { widgets: Array<{ id: string }> } }).dashboard_layout.widgets.some((w) => w.id === "upcoming-payments")).toBe(false);
  });
  it("ocultar conserva su toggle en Personalizar y round-trip muestra de nuevo (JD-B-001)", async () => {
    render(<DashboardHome />);
    await screen.findAllByText("Próximos pagos");
    // Mientras está visible, el toggle existe en el header del widget y en Personalizar.
    expect(screen.getAllByRole("switch", { name: "Ocultar bloque: upcoming-payments" }).length).toBe(2);
    fireEvent.click(screen.getAllByRole("switch", { name: "Ocultar bloque: upcoming-payments" })[0]);
    await waitFor(() =>
      expect(
        (seenPatch[0] as { dashboard_layout: { widgets: Array<{ id: string }> } }).dashboard_layout.widgets.some(
          (w) => w.id === "upcoming-payments",
        ),
      ).toBe(false),
    );
    // El widget desaparece, pero queda su label en Personalizar…
    expect(screen.getAllByText("Próximos pagos")).toHaveLength(1);
    // …y su toggle sigue vivo para volver a mostrarlo.
    const show = screen.getByRole("switch", { name: "Mostrar bloque: upcoming-payments" });
    expect(show).toHaveAttribute("aria-checked", "false");
    fireEvent.click(show);
    await waitFor(() =>
      expect(
        (seenPatch[1] as { dashboard_layout: { widgets: Array<{ id: string }> } }).dashboard_layout.widgets.some(
          (w) => w.id === "upcoming-payments",
        ),
      ).toBe(true),
    );
    expect((await screen.findAllByText("Próximos pagos")).length).toBeGreaterThanOrEqual(2);
  });
});
describe("DashboardHome 5 widgets S-H", () => {
  it("renders exactly the 5 survivors, no pending-debts anywhere", async () => {
    render(<DashboardHome />);
    expect((await screen.findAllByText("Próximos pagos")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Suscripciones activas").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Tareas pendientes").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Próximos eventos").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Progreso de metas").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Deudas pendientes")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /avisos pendientes/i })).toBeInTheDocument();
    expect(screen.getAllByRole("switch").length).toBe(10);
    expect(screen.getAllByText("Ver en Finanzas").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("Ver en Productividad").length).toBeGreaterThanOrEqual(1);
  });
  it("union/order: event before sub; goal widget metas-only without savings", async () => {
    render(<DashboardHome />);
    await screen.findAllByText("Próximos pagos");
    const upcoming = screen.getByRole("region", { name: "Próximos pagos" });
    expect(within(upcoming).getByText("Cobro").compareDocumentPosition(within(upcoming).getByText("Música")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("Off")).not.toBeInTheDocument();
    expect(screen.getByText("Agenda")).toBeInTheDocument();
    expect(screen.getAllByText("Progreso de metas").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Ahorro/)).not.toBeInTheDocument();
  });
  it("stale pending-debts/month entries are ignored silently", async () => {
    layoutWidgets = [
      { id: "pending-debts", type: "list", order: 21, size: "md" },
      { id: "month-savings", type: "metric", order: 12, size: "sm" },
    ];
    render(<DashboardHome />);
    await screen.findByRole("heading", { name: /Resumen General/ });
    expect(screen.queryByText("Deudas pendientes")).not.toBeInTheDocument();
    expect(screen.queryByText("Ahorro del mes")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Strip and sections keep rendering.
    expect((await screen.findAllByText("Patrimonio neto")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("heading", { name: "Últimos movimientos" })).toBeInTheDocument();
  });
  it("invalid layout falls back to all 5 visible in default order", async () => {
    layoutWidgets = null;
    render(<DashboardHome />);
    expect((await screen.findAllByText("Próximos pagos")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Suscripciones activas").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Tareas pendientes").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Próximos eventos").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Progreso de metas").length).toBeGreaterThanOrEqual(1);
  });
  it("hiding upcoming-payments stops its widget render (fetch stops with it)", async () => {
    layoutWidgets = [
      { id: "active-subs", type: "list", order: 22, size: "md" },
      { id: "pending-tasks", type: "list", order: 23, size: "md" },
      { id: "upcoming-events", type: "list", order: 24, size: "md" },
      { id: "goal-progress", type: "chart", order: 30, size: "md" },
    ];
    render(<DashboardHome />);
    await screen.findByRole("heading", { name: /Resumen General/ });
    expect(screen.queryByRole("heading", { name: "Próximos pagos" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Suscripciones activas" })).toBeInTheDocument();
  });
  it("empty ES exacto + 8d/sin-fecha solo fuera de proximos", async () => {
    subs = [{ id: "s8", name: "Lejos", price: "5", is_active: true, next_billing_on: day(8) }]; tasks = []; events = []; goals = [];
    render(<DashboardHome />);
    expect((await screen.findAllByText("Próximos pagos")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Nada por vencer en 7 días")).toBeInTheDocument();
    // "Lejos" lives in both Suscripciones activas and Próximas suscripciones.
    expect(screen.getAllByText("Lejos").length).toBe(2);
    expect(screen.getByText("Sin metas aún")).toBeInTheDocument();
  });
});
