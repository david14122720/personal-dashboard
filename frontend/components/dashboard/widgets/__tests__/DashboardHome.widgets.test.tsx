import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardHome from "@/components/containers/DashboardHome";
import { statusOnBogotaDay } from "@/components/dashboard/widgets/TodayHabits";
import { formatMovementDate, todayInBogota } from "@/lib/finance/finance";
// S-H: pending-debts retired, goal-progress metas-only.
// 2026-10-03 consolidation: net-worth strip KPI and active-subs widget retired, 4-widget default.
// S-F: the removed debt/savings hooks are deleted — any regression
// reintroducing a /debts or /savings-goals read fails the type check.
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate: vi.fn() }) }));
const q = (data: unknown) => ({ data, error: undefined, isLoading: false });
let netWorthCalls = 0;
const seenPatch: unknown[] = [];
let layoutWidgets: Array<{ id: string; type: string; order: number; size: string }> | null = null;
const day = (off: number) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`; };
let subs: unknown[] = [{ id: "s1", name: "Música", price: "9.99", is_active: true, next_billing_on: "__S5__" }];
let tasks: unknown[] = [{ id: "t1", title: "Tarea", status: "pending", due_date: "__T1__" }];
let events: unknown[] = [{ id: "e1", title: "Cobro", kind: "payment_due", starts_at: "__E2__" }, { id: "e10", title: "Agenda", kind: "event", starts_at: "__E10__" }];
let goals: unknown[] = [{ id: "g1", name: "Correr", progress: 60, status: "active" }];
let movements: unknown[] = [];
/** `GET /habits/today` rows as the API serves them on the UTC clock. */
let habitsToday: unknown[] = [];
/** `GET /habits/logs?from&to` rows for the widget's Bogotá day; `undefined`
 * keeps the auxiliary read unanswered so the boundary tests can pin it. */
let habitDayLogs: unknown[] | undefined = [];
const categories: unknown[] = [];
const fixDates = () => { subs = [{ id: "s1", name: "Música", price: "9.99", is_active: true, next_billing_on: day(5) }, { id: "sx", name: "Off", price: "5", is_active: false, next_billing_on: day(1) }]; tasks = [{ id: "t1", title: "Tarea", status: "pending", due_date: day(1) }]; events = [{ id: "e1", title: "Cobro", kind: "payment_due", starts_at: day(2) }, { id: "e10", title: "Agenda", kind: "event", starts_at: day(10) }]; };
let accounts: unknown[] = [];
vi.mock("@/lib/api/dashboard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api/dashboard")>();
  return { ...mod, useNetWorth: () => { netWorthCalls += 1; return q({ per_currency: [] }); }, useHabitsToday: () => q(habitsToday), useAccounts: () => q(accounts),
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
    // T2 (cierre-pendientes-dashboard): the two period panels read the ranged
    // hook; they filter client-side over the window they request, so the same
    // fixture feeds both.
    useMovementsRange: () => q(movements),
    // S1 (T5): the cycle KPI and the panels read the server summary. These
    // suites pin widget layout/history, not the KPI figure, so an empty
    // aggregate keeps the page honest without inventing numbers.
    useMovementsSummary: () =>
      q({
        totals: { expense: "0.00", income: "0.00", count: 0 },
        by_account: [],
        by_category: [],
        buckets: [],
        recent: [],
        recent_total: 0,
      }),
    useCategories: () => q(categories),
  };
});
// The «Hoy» widget reads its Bogotá day's real logs through `apiGet` → `fetch`
// (the shared hook and the widget's own error-aware read both go through it):
// the boundary tests control that single answer. `undefined` keeps the request
// pending so they can pin the unknown state; `habitDayFailure` makes it fail so
// they can pin the honest error state and its retry.
let habitDayFailure = false;
const fetchMock = vi.fn((_url: string) =>
  habitDayFailure
    ? Promise.reject(new Error("network down"))
    : habitDayLogs === undefined
      ? new Promise<Response>(() => {})
      : Promise.resolve({ ok: true, status: 200, json: async () => habitDayLogs } as Response),
);
vi.stubGlobal("fetch", fetchMock);
beforeEach(() => { seenPatch.length = 0; layoutWidgets = null; netWorthCalls = 0; accounts = []; movements.length = 0; habitsToday = []; habitDayLogs = []; habitDayFailure = false; fetchMock.mockClear(); fixDates(); goals = [{ id: "g1", name: "Correr", progress: 60, status: "active" }]; localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });
describe("DashboardHome strip + toggles S-H", () => {
  it("strip drops patrimonio: only cuentas, suscripciones and saldo total (W2 RED)", async () => {
    render(<DashboardHome />);
    await screen.findByText("Saldo total");
    expect(screen.getByText("Cuentas")).toBeInTheDocument();
    expect(screen.getByText("Suscripciones")).toBeInTheDocument();
    expect(screen.queryByText("Patrimonio neto")).not.toBeInTheDocument();
    expect(netWorthCalls).toBe(0);
  });
  it("no Suscripciones activas widget and exactly 4 customize rows (W2 RED)", async () => {
    render(<DashboardHome />);
    await screen.findAllByText("Próximos pagos");
    expect(screen.queryByText("Suscripciones activas")).not.toBeInTheDocument();
    const customize = screen.getByRole("region", { name: "Personalizar" });
    expect(within(customize).getAllByRole("listitem")).toHaveLength(4);
    expect(within(customize).getAllByRole("switch")).toHaveLength(4);
  });
  it("renders the 3-KPI strip with no month-split cards and no debts/savings", async () => {
    render(<DashboardHome />);
    expect(await screen.findByText("Cuentas")).toBeInTheDocument();
    expect(screen.getByText("Suscripciones")).toBeInTheDocument();
    expect(screen.getByText("Saldo total")).toBeInTheDocument();
    expect(screen.queryByText("Patrimonio neto")).not.toBeInTheDocument();
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
    expect(switches.length).toBe(8);
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
describe("DashboardHome 4 widgets S-H", () => {
  it("renders exactly the 4 survivors, no active-subs and no pending-debts anywhere", async () => {
    render(<DashboardHome />);
    expect((await screen.findAllByText("Próximos pagos")).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Suscripciones activas")).not.toBeInTheDocument();
    expect(screen.getAllByText("Tareas pendientes").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Próximos eventos").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Progreso de metas").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Deudas pendientes")).not.toBeInTheDocument();
    // The shell owns the single notification surface now (AppShell.test.tsx
    // asserts it on every route), so the page must not render a second bell.
    expect(screen.queryByRole("button", { name: /avisos pendientes/i })).toBeNull();
    expect(screen.getAllByRole("switch").length).toBe(8);
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
  it("stale pending-debts/month/active-subs entries are ignored silently", async () => {
    layoutWidgets = [
      { id: "pending-debts", type: "list", order: 21, size: "md" },
      { id: "month-savings", type: "metric", order: 12, size: "sm" },
      { id: "active-subs", type: "list", order: 22, size: "md" },
    ];
    render(<DashboardHome />);
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(screen.queryByText("Deudas pendientes")).not.toBeInTheDocument();
    expect(screen.queryByText("Ahorro del mes")).not.toBeInTheDocument();
    expect(screen.queryByText("Suscripciones activas")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /active-subs/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Strip and sections keep rendering.
    expect(await screen.findByText("Saldo total")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Últimos movimientos" })).toBeInTheDocument();
  });
  it("invalid layout falls back to all 4 visible in default order", async () => {
    layoutWidgets = null;
    render(<DashboardHome />);
    expect((await screen.findAllByText("Próximos pagos")).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Suscripciones activas")).not.toBeInTheDocument();
    expect(screen.getAllByText("Tareas pendientes").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Próximos eventos").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Progreso de metas").length).toBeGreaterThanOrEqual(1);
  });
  it("hiding upcoming-payments stops its widget render (fetch stops with it)", async () => {
    layoutWidgets = [
      { id: "pending-tasks", type: "list", order: 23, size: "md" },
      { id: "upcoming-events", type: "list", order: 24, size: "md" },
      { id: "goal-progress", type: "chart", order: 30, size: "md" },
    ];
    render(<DashboardHome />);
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(screen.queryByRole("heading", { name: "Próximos pagos" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tareas pendientes" })).toBeInTheDocument();
  });
  it("empty ES exacto + 8d/sin-fecha solo fuera de proximos", async () => {
    subs = [{ id: "s8", name: "Lejos", price: "5", is_active: true, next_billing_on: day(8) }]; tasks = []; events = []; goals = [];
    render(<DashboardHome />);
    expect((await screen.findAllByText("Próximos pagos")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Nada por vencer en 7 días")).toBeInTheDocument();
    // "Lejos" lives only in Próximas suscripciones now that the active-subscriptions widget is gone.
    expect(screen.getAllByText("Lejos").length).toBe(1);
    expect(screen.getByText("Sin metas aún")).toBeInTheDocument();
  });
});

describe("S3 snapshot three-direction rows (W2.7/W5.1)", () => {
  it("shows a transfer as Transferencia with its route and never as Ingreso", async () => {
    accounts = [
      { id: "a1", name: "Cuenta principal", currency: "COP", balance: "1000.00" },
      { id: "a2", name: "Bolsillo", currency: "COP", balance: "500.00" },
    ];
    movements = [
      {
        id: "e1",
        direction: "expense",
        amount: "100.00",
        occurred_on: "2026-10-02",
        description: null,
        account_id: "a1",
        transfer_account_id: null,
        category_id: null,
        subscription_id: null,
        created_at: "2026-10-02T10:00:00Z",
        updated_at: "2026-10-02T10:00:00Z",
      },
      {
        id: "t1",
        direction: "transfer",
        amount: "250.00",
        occurred_on: "2026-10-03",
        description: null,
        account_id: "a1",
        transfer_account_id: "a2",
        category_id: null,
        subscription_id: null,
        created_at: "2026-10-03T10:00:00Z",
        updated_at: "2026-10-03T10:00:00Z",
      },
    ];
    render(<DashboardHome />);
    const section = await screen.findByRole("region", { name: "Últimos movimientos" });
    expect(
      within(section).getByText(/Transferencia: Cuenta principal → Bolsillo/),
    ).toBeInTheDocument();
    expect(within(section).getByText(/Método de pago: Cuenta principal/)).toBeInTheDocument();
    expect(within(section).queryByText(/Ingreso/)).not.toBeInTheDocument();
  });
});

/**
 * T8d: `GET /habits/today` builds `today_status` from the database's UTC
 * `CURRENT_DATE`, which from 19:00 Bogotá is already the next day; the «Hoy»
 * card must keep deriving the day from the app's Bogotá business day so it can
 * never claim `pending` for a day whose real log says `done`.
 */
describe("Hoy card: UTC/Bogotá boundary (T8d)", () => {
  const NAMES = ["Ejercicio", "NO F, NO P", "tender la cama", "Leer 20 páginas", "Meditar"];
  const pendingRows = NAMES.map((name, index) => ({
    habit_id: `h${index}`,
    name,
    habit_frequency: "daily",
    days_of_week: [],
    current_streak: 3,
    today_status: "pending",
  }));
  const doneLogs = pendingRows.map((row) => ({
    habit_id: row.habit_id,
    log_date: "2026-10-11",
    status: "done",
  }));
  /** 00:09 UTC on the 12th = 19:09 on the 11th in America/Bogota. */
  const bogotaBoundary = new Date("2026-10-12T00:09:00Z");

  it("statusOnBogotaDay: the day's log wins; only a missing log falls back to the schedule", () => {
    const row = {
      habit_id: "h1",
      name: "Correr",
      habit_frequency: "daily",
      days_of_week: [] as number[],
      current_streak: 0,
      today_status: "pending",
    };
    expect(
      statusOnBogotaDay(row, "2026-10-11", [
        { habit_id: "h1", log_date: "2026-10-11", status: "done" },
      ]),
    ).toBe("done");
    expect(statusOnBogotaDay(row, "2026-10-11", [])).toBe("pending");
    // 2026-10-12 is a Monday; a Sunday-only mask does not expect it.
    expect(statusOnBogotaDay({ ...row, days_of_week: [0] }, "2026-10-12", [])).toBe("skipped");
  });

  it("renders the real 5 de 5 registrados when the API says pending and the Bogotá log says done", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(bogotaBoundary);
    habitsToday = pendingRows;
    habitDayLogs = doneLogs;

    render(<DashboardHome />);

    const card = screen.getByRole("region", { name: "Hoy" });
    // The count is never claimed before the day's logs answer.
    expect(within(card).queryByText(/registrados/)).toBeNull();
    expect(await within(card).findByText("5 de 5 registrados")).toBeInTheDocument();
    // The read asks for the Bogotá day (the 11th), never the UTC day (the 12th).
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("from=2026-10-11&to=2026-10-11")),
    ).toBe(true);
    expect(within(card).getAllByLabelText(/registrado hoy/)).toHaveLength(5);
    expect(within(card).queryByLabelText(/pendiente hoy/)).toBeNull();
    const boxes = within(card).getAllByRole("checkbox");
    expect(boxes).toHaveLength(5);
    for (const box of boxes) expect(box).toBeChecked();
  });

  it("stays honest without a log for the Bogotá day: 0 de 5, unchecked, pendiente hoy", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(bogotaBoundary);
    habitsToday = pendingRows;
    habitDayLogs = [];

    render(<DashboardHome />);

    const card = screen.getByRole("region", { name: "Hoy" });
    expect(await within(card).findByText("0 de 5 registrados")).toBeInTheDocument();
    expect(within(card).getByLabelText("Ejercicio, pendiente hoy")).not.toBeChecked();
    for (const box of within(card).getAllByRole("checkbox")) expect(box).not.toBeChecked();
  });

  it("claims no count and no pending while the day's log read has not answered", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(bogotaBoundary);
    habitsToday = pendingRows;
    habitDayLogs = undefined;

    render(<DashboardHome />);

    const card = screen.getByRole("region", { name: "Hoy" });
    expect(within(card).queryByText(/registrados/)).toBeNull();
    // Rows still render with name and streak, but state the unknown — never `pending`.
    expect(within(card).getByText("Ejercicio")).toBeInTheDocument();
    expect(within(card).getAllByText("racha de 3 días")).toHaveLength(5);
    expect(within(card).getByLabelText("Ejercicio, estado de hoy sin registrar")).not.toBeChecked();
    expect(within(card).queryByLabelText(/pendiente hoy/)).toBeNull();
    expect(within(card).queryByLabelText(/registrado hoy/)).toBeNull();
  });
});

/**
 * JD item 2: the day-logs read is a second, independent read (T8d) and it had
 * no error branch — when it failed, every row kept reading as unregistered
 * forever with no explanation and no way to retry. The card must say the read
 * failed and offer a real retry that re-runs it, while staying honest about the
 * unknown state only while the read is genuinely unanswered.
 */
describe("Hoy card: failed day read (JD item 2)", () => {
  const rows = [
    {
      habit_id: "h1",
      name: "Ejercicio",
      habit_frequency: "daily",
      days_of_week: [] as number[],
      current_streak: 3,
      today_status: "pending",
    },
  ];
  const logs = [{ habit_id: "h1", log_date: "2026-10-11", status: "done" }];

  it("says the read failed and recovers the real state through Reintentar", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T00:09:00Z"));
    habitsToday = rows;
    habitDayLogs = logs;
    habitDayFailure = true;

    render(<DashboardHome />);

    const card = screen.getByRole("region", { name: "Hoy" });
    // The failure is stated, never silently rendered as `not done`.
    const alert = await within(card).findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(within(card).queryByText(/registrados/)).toBeNull();
    // The row is still listed, but its state is the honest unknown one.
    expect(within(card).getByLabelText("Ejercicio, estado de hoy sin registrar")).not.toBeChecked();

    // A real retry: the read is issued again and the card shows the real state.
    const callsBefore = fetchMock.mock.calls.length;
    habitDayFailure = false;
    fireEvent.click(within(card).getByRole("button", { name: "Reintentar" }));
    expect(await within(card).findByText("1 de 1 registrados")).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(within(card).getByLabelText("Ejercicio, registrado hoy")).toBeChecked();
    expect(within(card).queryByRole("alert")).toBeNull();
  });
});

/**
 * JD item 3: the list sliced to five and rendered that slice length as
 * `N registros`, so the card both under-reported the real record count and hid
 * the newest row with no marker (the sixth record was the only income). The
 * counter must state the real total and mark the hidden rows.
 */
describe("Últimos movimientos counter (JD item 3)", () => {
  const movement = (id: string, direction: string, amount: string, occurredOn: string) => ({
    id,
    direction,
    amount,
    occurred_on: occurredOn,
    description: null,
    account_id: "a1",
    transfer_account_id: null,
    category_id: null,
    subscription_id: null,
    created_at: `${occurredOn}T10:00:00Z`,
    updated_at: `${occurredOn}T10:00:00Z`,
  });

  it("reports the real total and marks the hidden rows instead of calling the slice the count", async () => {
    accounts = [{ id: "a1", name: "Cuenta principal", currency: "COP", balance: "1000.00" }];
    movements = [
      movement("m5", "expense", "100.00", "2026-10-05"),
      movement("m4", "expense", "100.00", "2026-10-04"),
      movement("m3", "expense", "100.00", "2026-10-03"),
      movement("m2", "expense", "100.00", "2026-10-02"),
      movement("m1", "expense", "100.00", "2026-10-01"),
      movement("m6", "income", "500.00", "2026-09-30"),
    ];

    render(<DashboardHome />);

    const card = await screen.findByRole("region", { name: "Últimos movimientos" });
    // Six real records, five rendered rows: the pill states both numbers, so
    // the slice is never reported as the record count.
    expect(within(card).getByText("6 registros · +1 más")).toBeInTheDocument();
    expect(within(card).getAllByRole("listitem")).toHaveLength(5);
    // The hidden sixth record (the only income) is declared, not silently gone.
    expect(within(card).queryByText(/Ingreso/)).toBeNull();
  });
});

/**
 * JD item 5: two copy/state mismatches in the «Hoy» card.
 * (a) a habit the day does not schedule is `skipped`, which had no label and
 * fell back to the unregistered copy while still counting in the denominator;
 * (b) with zero habits the card claimed every habit was already registered.
 */
describe("Hoy card: schedule and empty state (JD item 5)", () => {
  const daily = (index: number) => ({
    habit_id: `h${index}`,
    name: `Hábito ${index}`,
    habit_frequency: "daily",
    days_of_week: [] as number[],
    current_streak: 1,
    today_status: "pending",
  });

  it("labels a habit today does not schedule as not scheduled and keeps it out of the denominator", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T00:09:00Z")); // Bogotá Sunday 2026-10-11
    habitsToday = [
      daily(1),
      {
        habit_id: "h9",
        name: "Gimnasio",
        habit_frequency: "weekly",
        days_of_week: [1], // Monday only, not today
        current_streak: 0,
        today_status: "pending",
      },
    ];
    habitDayLogs = [];

    render(<DashboardHome />);

    const card = screen.getByRole("region", { name: "Hoy" });
    // The real state is stated: not scheduled today, never "unregistered".
    expect(await within(card).findByLabelText("Gimnasio, no programado hoy")).toBeInTheDocument();
    expect(within(card).queryByLabelText(/sin registrar/)).toBeNull();
    // Only the habits today expects count: 2 rows, 1 of them registered/due.
    expect(within(card).getByText("0 de 1 registrados")).toBeInTheDocument();
  });

  it("does not tell a user with no habits that everything is already registered", async () => {
    habitsToday = [];
    habitDayLogs = [];

    render(<DashboardHome />);

    const card = screen.getByRole("region", { name: "Hoy" });
    expect(await within(card).findByText("Sin hábitos aún")).toBeInTheDocument();
    expect(within(card).queryByText("Todos los hábitos están registrados por hoy.")).toBeNull();
    expect(within(card).queryByText("Nada pendiente")).toBeNull();
  });
});

/**
 * JD item 8: the shell mounts two bells (the compact mobile one and the full
 * top-bar one). Each `useNotifications()` call used to own a private muted
 * state, so muting in one left the other's badge stale until a reload —
 * visible when resizing across 768px. This suite renders the two real bells
 * against the real hook and the shared store. (The natural home for it,
 * `components/notifications/__tests__/notifications.test.tsx`, is outside this
 * fix's allowed edit surfaces, so the pin lives here with its reason.)
 */
describe("two bells share one muted state (JD item 8)", () => {
  it("a mute in one bell clears the other badge without a reload", async () => {
    tasks = [{ id: "t-old", title: "Tarea", status: "pending", due_date: day(-2) }];
    const { default: NotificationBell } = await import(
      "@/components/notifications/NotificationBell"
    );

    render(
      <>
        <NotificationBell />
        <NotificationBell variant="compact" />
      </>,
    );

    // Both instances agree before the interaction.
    const before = (await screen.findAllByTestId("p8-badge")).map((b) => b.textContent);
    expect(before).toHaveLength(2);
    expect(before[0]).toBe(before[1]);
    expect(Number(before[0])).toBeGreaterThan(0);

    // Mute through the first bell's dialog only.
    fireEvent.click(screen.getAllByRole("button", { name: /avisos pendientes/ })[0]);
    fireEvent.click((await screen.findAllByRole("switch"))[0]);

    // The second bell never received the interaction, yet its badge must follow.
    const expected = String(Number(before[0]) - 1);
    await waitFor(() => {
      expect(screen.getAllByTestId("p8-badge").map((b) => b.textContent)).toEqual([
        expected,
        expected,
      ]);
    });
    expect(
      screen.getAllByRole("button", {
        name: new RegExp(`${expected} avisos pendientes`),
      }),
    ).toHaveLength(2);
    // The one muted item is the only persisted key.
    const stored = JSON.parse(localStorage.getItem("p8-notif-muted") ?? "{}") as Record<
      string,
      true
    >;
    expect(Object.values(stored)).toEqual([true]);
  });
});

/**
 * JD item 1: a calendar date must render as that same calendar date in every
 * device zone. The old helper built a local-midnight `Date` and formatted it
 * with `timeZone: "America/Bogota"`, so from `TZ=UTC` (or any zone east of
 * Bogotá) `2026-10-15` rendered as the 14th. These assertions hold in any
 * ambient zone, which is exactly the invariant; the RED evidence is this same
 * file run under `TZ=UTC` against the old helper.
 */
describe("calendar dates are device-zone independent (JD item 1)", () => {
  it("renders a calendar date as that same calendar date", () => {
    expect(formatMovementDate("2026-10-15")).toBe("15 de oct de 2026");
    expect(formatMovementDate("2026-01-01")).toBe("1 de ene de 2026");
    // Garbage still passes through untouched.
    expect(formatMovementDate("24/09/2026")).toBe("24/09/2026");
  });

  it("renders the real next charge date in Próximas suscripciones", async () => {
    subs = [
      { id: "s1", name: "Música", price: "9.99", is_active: true, next_billing_on: "2031-01-01" },
    ];
    render(<DashboardHome />);
    const card = await screen.findByRole("region", { name: "Próximas suscripciones" });
    expect(within(card).getByText("1 de ene de 2031")).toBeInTheDocument();
  });

  it("labels the mobile status row with the real Bogotá calendar day", async () => {
    render(<DashboardHome />);
    // Same Intl recipe the helper must use, anchored in UTC: the rendered date
    // can never be the previous day of a device zone.
    const expected = new Intl.DateTimeFormat("es-CO", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${todayInBogota()}T12:00:00Z`));
    expect(await screen.findByText(expected)).toBeInTheDocument();
  });
});
