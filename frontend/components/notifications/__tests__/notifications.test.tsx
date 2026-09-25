import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MUTED_KEY, useNotifications } from "../useNotifications";
import NotificationBell from "../NotificationBell";
import NotificationList from "../NotificationList";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
const q = (data: unknown) => ({ data, error: undefined, isLoading: false });
// S-F: the debt/savings hooks are deleted — the mock spreads the surviving
// module instead of excluding removed hooks. Any regression reintroducing a
// /debts or /savings-goals read fails the type check.
let subs: unknown[] | null = null;
let tasks: unknown[] | null = null;
let events: unknown[] | null = null;
let layout: { widgets: Array<{ id: string; type: string; order: number; size: string }> } | null = null;
vi.mock("@/lib/api/dashboard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api/dashboard")>();
  return { ...mod, useSubscriptions: () => q(subs ?? []), useTasks: () => q(tasks ?? []), useEvents: () => q(events ?? []),
    usePreferences: () => q({ preferences: { currency_code: "COP", locale: "es-CO", dashboard_layout: layout } }) };
});
const day = (off: number) => {
  const d = new Date(); d.setDate(d.getDate() + off);
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
};
function Probe() {
  const n = useNotifications();
  return (<div><output data-testid="p8-count">{`${n.count}|${n.overdue.length}|${n.upcoming.length}`}</output>
    <button type="button" onClick={() => n.toggleMute("s-3")}>mute-s-3</button></div>);
}
beforeEach(() => { subs = []; tasks = []; events = []; layout = null; localStorage.clear(); });

describe("useNotifications S-H (sin deudas)", () => {
  it("badge = vencidas (tasks + eventos pasados) + 7d visibles, sin deudas", async () => {
    tasks = [{ id: "t-old", title: "Tarea", status: "pending", due_date: day(-2) }];
    events = [{ id: "e-old", title: "Cobro vencido", kind: "payment_due", starts_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString() }];
    subs = [{ id: "s-3", name: "Música", price: "9.99", is_active: true, next_billing_on: day(3) }];
    render(<Probe />);
    expect(await screen.findByTestId("p8-count")).toHaveTextContent("3|2|1");
  });
  it("próximos cobros = misma unión y orden que upcoming-payments (eventos antes que subs en empate)", async () => {
    const { toUpcomingPayments } = await import("@/lib/dashboard/transforms");
    subs = [{ id: "s-2", name: "Sub", price: 5, is_active: true, next_billing_on: day(2) }];
    // Local midnight of the same day: a true tie, broken events > subs.
    const tie = new Date(); tie.setDate(tie.getDate() + 2); tie.setHours(0, 0, 0, 0);
    events = [{ id: "e-2", title: "Cobro", kind: "payment_due", starts_at: tie.toISOString() }];
    const { container } = render(<Probe />);
    expect(await screen.findByTestId("p8-count")).toHaveTextContent("2|0|2");
    void container;
    const union = toUpcomingPayments(subs as never, events as never, new Date());
    expect(union.map((i) => i.id)).toEqual(["e-2", "s-2"]);
  });
  it("ventana 7d inclusiva, 8d fuera y sin-fecha excluida", async () => {
    subs = [{ id: "s-7", name: "S7", price: 5, is_active: true, next_billing_on: day(7) }, { id: "s-8", name: "S8", price: 5, is_active: true, next_billing_on: day(8) }, { id: "s-x", name: "SinFecha", price: 5, is_active: true, next_billing_on: null }];
    render(<Probe />);
    expect(await screen.findByTestId("p8-count")).toHaveTextContent("1|0|1");
  });
  it("mute por item resta del badge, sigue listado y persiste reload", async () => {
    subs = [{ id: "s-3", name: "Música", price: 10, is_active: true, next_billing_on: day(3) }];
    const { unmount } = render(<Probe />);
    expect(await screen.findByTestId("p8-count")).toHaveTextContent("1|0|1");
    fireEvent.click(screen.getByRole("button", { name: "mute-s-3" }));
    expect(await screen.findByTestId("p8-count")).toHaveTextContent("0|0|1");
    expect(JSON.parse(localStorage.getItem(MUTED_KEY) ?? "{}")).toEqual({ "s-3": true });
    unmount(); render(<Probe />);
    expect(await screen.findByTestId("p8-count")).toHaveTextContent("0|0|1");
  });
  it("un mute de deuda archivado queda inerte: sin error y sin efecto en el badge", async () => {
    subs = [{ id: "s-3", name: "Música", price: 5, is_active: true, next_billing_on: day(3) }];
    localStorage.setItem(MUTED_KEY, JSON.stringify({ "debt:abc": true }));
    render(<Probe />);
    expect(await screen.findByTestId("p8-count")).toHaveTextContent("1|0|1");
  });
  it("mute por categoria via layout excluye del badge", async () => {
    const { DEFAULT_DASHBOARD_LAYOUT } = await import("@/lib/api/dashboard");
    layout = { widgets: DEFAULT_DASHBOARD_LAYOUT.widgets.filter((w) => w.id !== "active-subs" && w.id !== "upcoming-payments") };
    subs = [{ id: "s-3", name: "Música", price: 5, is_active: true, next_billing_on: day(3) }];
    tasks = [{ id: "t-old", title: "Tarea", status: "pending", due_date: day(-1) }];
    render(<Probe />);
    expect(await screen.findByTestId("p8-count")).toHaveTextContent("1|1|0");
  });
});

describe("NotificationBell S-H", () => {
  it("badge accesible con panel teclado y Esc", async () => {
    tasks = [{ id: "t-old", title: "Tarea", price: 10, status: "pending", due_date: day(-1) }];
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

describe("NotificationList S-H", () => {
  it("vacios exactos, orden, switch y ver-en-seccion", async () => {
    const { rerender } = render(<NotificationList overdue={[]} upcoming={[]} muted={{}} onToggleMute={() => {}} />);
    expect(screen.getByText("Sin vencidas 🎉")).toBeInTheDocument();
    expect(screen.getByText("Nada por vencer en 7 días")).toBeInTheDocument();
    const onToggle = vi.fn();
    rerender(<NotificationList overdue={[{ id: "b", kind: "event", title: "B", due: day(-1), source: "event" }, { id: "a", kind: "task", title: "A", due: day(-5), source: "task" }]} upcoming={[{ id: "s-1", kind: "subscription", title: "Sub", due: day(2), amount: 999, source: "subscription" }]} muted={{}} onToggleMute={onToggle} />);
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
