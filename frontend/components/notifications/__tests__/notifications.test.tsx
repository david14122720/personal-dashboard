import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MUTED_KEY, useNotifications } from "../useNotifications";
import NotificationBell from "../NotificationBell";
import NotificationList from "../NotificationList";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
const q = (data: unknown) => ({ data, error: undefined, isLoading: false });
let debts: unknown[] | null = null;
let subs: unknown[] | null = null;
let tasks: unknown[] | null = null;
let events: unknown[] | null = null;
let layout: { widgets: Array<{ id: string; type: string; order: number; size: string }> } | null = null;
vi.mock("@/lib/api/dashboard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api/dashboard")>();
  return { ...mod, useDebts: () => q(debts ?? []), useSubscriptions: () => q(subs ?? []), useTasks: () => q(tasks ?? []), useEvents: () => q(events ?? []),
    usePreferences: () => q({ preferences: { currency_code: "COP", locale: "es-CO", dashboard_layout: layout } }) };
});
const day = (off: number) => {
  const d = new Date(); d.setDate(d.getDate() + off);
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
};
function Probe() {
  const n = useNotifications();
  return (<div><output data-testid="p8-count">{`${n.count}|${n.overdue.length}|${n.upcoming.length}`}</output>
    <button type="button" onClick={() => n.toggleMute("d-old")}>mute-d-old</button></div>);
}
beforeEach(() => { debts = []; subs = []; tasks = []; events = []; layout = null; localStorage.clear(); });

describe("useNotifications p8-pr3", () => {
  it("badge = vencidas + 7d visibles", async () => {
    debts = [{ id: "d-old", name: "Deuda", pending_amount: "320.00", status: "active", due_date: day(-1) }];
    tasks = [{ id: "t-old", title: "Tarea", status: "pending", due_date: day(-2) }];
    subs = [{ id: "s-3", name: "Música", price: "9.99", is_active: true, next_billing_on: day(3) }];
    events = [];
    render(<Probe />);
    expect(await screen.findByTestId("p8-count")).toHaveTextContent("3|2|1");
  });
  it("ventana 7d inclusiva, 8d fuera y sin-fecha excluida", async () => {
    subs = [{ id: "s-7", name: "S7", price: 5, is_active: true, next_billing_on: day(7) }, { id: "s-8", name: "S8", price: 5, is_active: true, next_billing_on: day(8) }];
    debts = [{ id: "d-0", name: "Hoy", pending_amount: 10, status: "active", due_date: day(0) }, { id: "d-x", name: "SinFecha", pending_amount: 10, status: "active" }];
    render(<Probe />);
    expect(await screen.findByTestId("p8-count")).toHaveTextContent("2|0|2");
  });
  it("mute por item resta del badge, sigue listado y persiste reload", async () => {
    debts = [{ id: "d-old", name: "Deuda", pending_amount: 10, status: "active", due_date: day(-1) }];
    const { unmount } = render(<Probe />);
    expect(await screen.findByTestId("p8-count")).toHaveTextContent("1|1|0");
    fireEvent.click(screen.getByRole("button", { name: "mute-d-old" }));
    expect(await screen.findByTestId("p8-count")).toHaveTextContent("0|1|0");
    expect(JSON.parse(localStorage.getItem(MUTED_KEY) ?? "{}")).toEqual({ "d-old": true });
    unmount(); render(<Probe />);
    expect(await screen.findByTestId("p8-count")).toHaveTextContent("0|1|0");
  });
  it("mute por categoria via layout excluye del badge", async () => {
    const { DEFAULT_DASHBOARD_LAYOUT } = await import("@/lib/api/dashboard");
    layout = { widgets: DEFAULT_DASHBOARD_LAYOUT.widgets.filter((w) => w.id !== "active-subs" && w.id !== "upcoming-payments") };
    subs = [{ id: "s-3", name: "Música", price: 5, is_active: true, next_billing_on: day(3) }];
    debts = [{ id: "d-old", name: "Deuda", pending_amount: 10, status: "active", due_date: day(-1) }];
    render(<Probe />);
    expect(await screen.findByTestId("p8-count")).toHaveTextContent("1|1|0");
  });
});

describe("NotificationBell p8-pr3", () => {
  it("badge accesible con panel teclado y Esc", async () => {
    debts = [{ id: "d-old", name: "Deuda", pending_amount: 10, status: "active", due_date: day(-1) }];
    render(<NotificationBell />);
    const btn = await screen.findByRole("button", { name: /1 avisos pendientes/ });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("dialog", { name: "Avisos" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });
});

describe("NotificationList p8-pr3", () => {
  it("vacios exactos, orden, switch y ver-en-seccion", async () => {
    const { rerender } = render(<NotificationList overdue={[]} upcoming={[]} muted={{}} onToggleMute={() => {}} />);
    expect(screen.getByText("Sin vencidas 🎉")).toBeInTheDocument();
    expect(screen.getByText("Nada por vencer en 7 días")).toBeInTheDocument();
    const onToggle = vi.fn();
    rerender(<NotificationList overdue={[{ id: "b", kind: "debt", title: "B", due: day(-1), source: "debt" }, { id: "a", kind: "task", title: "A", due: day(-5), source: "task" }]} upcoming={[{ id: "s-1", kind: "subscription", title: "Sub", due: day(2), amount: 999, source: "subscription" }]} muted={{}} onToggleMute={onToggle} />);
    const rows = screen.getAllByRole("switch");
    expect(rows).toHaveLength(3);
    expect(screen.getByText("A").compareDocumentPosition(screen.getByText("B")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /B/ }));
    expect(onToggle).toHaveBeenCalledWith("b");
    expect(screen.getAllByText("Ver en Finanzas").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Ver en Productividad").length).toBeGreaterThanOrEqual(1);
    await act(async () => {});
  });
});
