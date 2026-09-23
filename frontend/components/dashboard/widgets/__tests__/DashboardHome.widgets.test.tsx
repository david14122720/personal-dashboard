import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardHome from "@/components/containers/DashboardHome";
// S3b: useMonthlyFlow/useSpendByCategory were deleted with the ledger
// (dangling-reference fix: this file keeps only surviving-widget cases).
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate: vi.fn() }) }));
const q = (data: unknown) => ({ data, error: undefined, isLoading: false });
const seenPatch: unknown[] = [];
let layoutWidgets: Array<{ id: string; type: string; order: number; size: string }> | null = null;
const day = (off: number) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`; };
let debts: unknown[] = [{ id: "d1", name: "Deuda", pending_amount: "500.00", status: "active", due_date: "__D2__" }];
let subs: unknown[] = [{ id: "s1", name: "Música", price: "9.99", is_active: true, next_billing_on: "__S5__" }];
let tasks: unknown[] = [{ id: "t1", title: "Tarea", status: "pending", due_date: "__T1__" }];
let events: unknown[] = [{ id: "e1", title: "Cobro", kind: "payment_due", starts_at: "__E2__" }, { id: "e10", title: "Agenda", kind: "event", starts_at: "__E10__" }];
let goals: unknown[] = [{ id: "g1", name: "Correr", progress: 60, status: "active" }];
let savings: unknown[] = [{ id: "sg1", name: "Viaje", goal: "1000.00", saved: "500.00" }];
const fixDates = () => { debts = [{ id: "d1", name: "Deuda", pending_amount: "500.00", status: "active", due_date: day(2) }, { id: "dx", name: "Pagada", pending_amount: "10", status: "paid_off", due_date: day(2) }]; subs = [{ id: "s1", name: "Música", price: "9.99", is_active: true, next_billing_on: day(5) }, { id: "sx", name: "Off", price: "5", is_active: false, next_billing_on: day(1) }]; tasks = [{ id: "t1", title: "Tarea", status: "pending", due_date: day(1) }]; events = [{ id: "e1", title: "Cobro", kind: "payment_due", starts_at: day(2) }, { id: "e10", title: "Agenda", kind: "event", starts_at: day(10) }]; };
vi.mock("@/lib/api/dashboard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api/dashboard")>();
  return { ...mod, useNetWorth: () => q({ per_currency: [] }), useHabitsToday: () => q([]), useAccounts: () => q([]),
      useDebts: () => q(debts), useSubscriptions: () => q(subs), useTasks: () => q(tasks), useEvents: () => q(events), useGoals: () => q(goals), useSavingsGoals: () => q(savings),
    usePreferences: () => q({ preferences: { currency_code: "COP", locale: "es-CO", dashboard_layout: layoutWidgets ? { widgets: layoutWidgets } : null } }),
    useUpdateLayout: () => async (next: { widgets: unknown[] }) => { seenPatch.push({ dashboard_layout: next }); layoutWidgets = next.widgets as typeof layoutWidgets; } };
});
vi.mock("@/lib/api/finance", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api/finance")>();
  return {
    ...mod,
    useSubscriptions: () => q(subs),
    useDebts: () => q(debts),
    useSavingsGoals: () => q(savings),
  };
});
beforeEach(() => { seenPatch.length = 0; layoutWidgets = null; fixDates(); goals = [{ id: "g1", name: "Correr", progress: 60, status: "active" }]; savings = [{ id: "sg1", name: "Viaje", goal: "1000.00", saved: "500.00" }]; localStorage.clear(); });
describe("DashboardHome strip + toggles S3b", () => {
  it("renders the 5-KPI strip with no month-split cards", async () => {
    render(<DashboardHome />);
    expect((await screen.findAllByText("Patrimonio neto")).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Ingreso del mes")).not.toBeInTheDocument();
    expect(screen.queryByText("Gasto del mes")).not.toBeInTheDocument();
    expect(screen.queryByText("Ahorro del mes")).not.toBeInTheDocument();
  });
  it("toggles hide one widget with exact PATCH envelope and round-trips", async () => {
    render(<DashboardHome />);
    await screen.findAllByText("Próximos pagos");
    const switches = screen.getAllByRole("switch");
    expect(switches.length).toBeGreaterThanOrEqual(6);
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
describe("DashboardHome resto widgets p8-pr4", () => {
  it("renders 6 widgets union/orden/segmentos + bell header", async () => {
    render(<DashboardHome />);
    expect((await screen.findAllByText("Próximos pagos")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Deudas pendientes").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Suscripciones activas").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Tareas pendientes").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Próximos eventos").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Progreso de metas").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Deuda").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Pagada")).not.toBeInTheDocument();
    expect(screen.queryByText("Off")).not.toBeInTheDocument();
    expect(screen.getByText("Agenda")).toBeInTheDocument();
    expect(screen.getAllByText(/Metas/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Ahorro/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: /avisos pendientes/i })).toBeInTheDocument();
    expect(screen.getAllByRole("switch").length).toBeGreaterThanOrEqual(9);
    expect(screen.getAllByText("Ver en Finanzas").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("Ver en Productividad").length).toBeGreaterThanOrEqual(3);
  });
  it("empty ES exacto + 8d/sin-fecha solo fuera de proximos", async () => {
    debts = [{ id: "dx", name: "SinFecha", pending_amount: "10", status: "active" }]; subs = [{ id: "s8", name: "Lejos", price: "5", is_active: true, next_billing_on: day(8) }]; tasks = []; events = []; goals = []; savings = [];
    render(<DashboardHome />);
    expect((await screen.findAllByText("Próximos pagos")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Nada por vencer en 7 días")).toBeInTheDocument();
    expect(screen.getByText("SinFecha")).toBeInTheDocument();
    expect(screen.getByText("Lejos")).toBeInTheDocument();
    expect(screen.getByText("Sin metas aún")).toBeInTheDocument();
  });
});
