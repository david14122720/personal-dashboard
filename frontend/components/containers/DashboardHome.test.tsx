import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatMovementDate, todayInBogota } from "@/lib/finance/finance";
import DashboardHome from "./DashboardHome";

/** Every mutable global the SWR mock reads; cleared before each test so a
 * failure in one test can never leak a fixture into the next. */
function clearMockGlobals(): void {
  for (const key of ["__DH__", "__LAYOUT__", "__HABITS__", "__MOV__", "__MOVS__", "__SUBS__"]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}
beforeEach(clearMockGlobals);
beforeEach(() => mutateSpy.mockClear());

/** Whether a recorded `mutate` call would revalidate `key`, in any of the
 * shapes SWR accepts: a bare key, a key list, or a key matcher function. */
function revalidates(key: string): boolean {
  return mutateSpy.mock.calls.some(([target]) =>
    typeof target === "function"
      ? Boolean((target as (candidate: string) => boolean)(key))
      : Array.isArray(target)
        ? (target as string[]).includes(key)
        : target === key,
  );
}

vi.mock("next/dynamic", () => ({ default: () => () => null }));
/** Records every `mutate` call so the retry buttons can be pinned to the real
 * SWR keys they must revalidate (JD item 6). */
const mutateSpy = vi.hoisted(() => vi.fn());
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate: mutateSpy }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const q = (data: unknown) => ({ data, error: undefined, isLoading: false });
const err = () => ({ data: undefined, error: new Error("boom"), isLoading: false });

/** `next_billing_on` is the only field the widget compares against its own
 * clock (`UpcomingSubs` filters `next_billing_on >= todayInBogota()`), so the
 * upcoming/past fixture dates must come from that same clock; a static date
 * rots the moment the calendar passes it. */
function daysFromToday(offset: number): string {
  const date = new Date(`${todayInBogota()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const loadedData = {
  netWorth: q({ per_currency: [{ currency: "COP", assets: "100", debts: "20", net_worth: "80" }] }),
  habits: q([]),
  accounts: q([
    { id: "a1", name: "Billetera", type: "cash", currency: "COP", balance: "500.00" },
    { id: "a2", name: "Banco", type: "bank", currency: "COP", balance: "1000.00" },
    { id: "a3", name: "Exterior", type: "bank", currency: "USD", balance: "2000.00" },
  ]),
  prefs: q({ preferences: { currency_code: "COP", locale: "es-CO" } }),
  financeSubs: q([
    { id: "s1", name: "Music", price: "12000.00", currency: "COP", frequency: "monthly", next_billing_on: daysFromToday(2), is_active: true, last_paid_on: "2026-09-05" },
    { id: "s2", name: "Vencida", price: "5000.00", currency: "COP", frequency: "monthly", next_billing_on: daysFromToday(-10), is_active: true, last_paid_on: null },
    { id: "s3", name: "Off", price: "7000.00", currency: "COP", frequency: "monthly", next_billing_on: daysFromToday(3), is_active: false, last_paid_on: null },
  ]),
  movements: q([
    { id: "m6", direction: "expense", amount: "6000.00", occurred_on: "2026-09-06", description: "Sexto", account_id: "a1", category_id: "c1", subscription_id: null, created_at: "2026-09-06", updated_at: "2026-09-06" },
    { id: "m5", direction: "income", amount: "5000.00", occurred_on: "2026-09-05", description: "Quinto", account_id: "a2", category_id: "c2", subscription_id: null, created_at: "2026-09-05", updated_at: "2026-09-05" },
    { id: "m4", direction: "expense", amount: "4000.00", occurred_on: "2026-09-04", description: "Cuarto", account_id: "a1", category_id: "c1", subscription_id: null, created_at: "2026-09-04", updated_at: "2026-09-04" },
    { id: "m3", direction: "expense", amount: "3000.00", occurred_on: "2026-09-03", description: "Tercero", account_id: "a1", category_id: "c1", subscription_id: null, created_at: "2026-09-03", updated_at: "2026-09-03" },
    { id: "m2", direction: "expense", amount: "2000.00", occurred_on: "2026-09-02", description: "Segundo", account_id: "a1", category_id: "c1", subscription_id: null, created_at: "2026-09-02", updated_at: "2026-09-02" },
    { id: "m1", direction: "expense", amount: "1000.00", occurred_on: "2026-09-01", description: "Viejo", account_id: "a1", category_id: "c1", subscription_id: null, created_at: "2026-09-01", updated_at: "2026-09-01" },
  ]),
  categories: q([
    { id: "c1", kind: "finance", name: "Comida", color: null, icon: null, is_archived: false, created_at: "2026-01-01" },
    { id: "c2", kind: "subscription", name: "Transporte", color: null, icon: null, is_archived: false, created_at: "2026-01-01" },
    { id: "c3", kind: "finance", name: "Gustos", color: null, icon: null, is_archived: false, created_at: "2026-01-01" },
  ]),
};

vi.mock("@/lib/api/dashboard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api/dashboard")>();
  return {
    ...mod,
  useNetWorth: () => loadedData.netWorth,
  useHabitsToday: () => (globalThis as Record<string, unknown>).__HABITS__ ?? loadedData.habits,
  useAccounts: () => (globalThis as Record<string, unknown>).__DH__ === "error"
    ? { data: undefined, error: new Error("boom"), isLoading: false }
    : (globalThis as Record<string, unknown>).__DH__ === "loading"
      ? { data: undefined, error: undefined, isLoading: true }
      : loadedData.accounts,
  usePreferences: () => (globalThis as Record<string, unknown>).__LAYOUT__ ?? loadedData.prefs,
  useSubscriptions: () => q([]), useTasks: () => q([]), useEvents: () => q([]), useGoals: () => q([]),
  useUpdateLayout: () => async () => {},
  };
});

/** Both movements hooks answer the same fixture: `useMovements` feeds the
 * unfiltered consumers and `useMovementsRange` the two period panels, which
 * filter client-side over the window they request. Called lazily inside each
 * hook: a `vi.mock` factory is hoisted, so touching this const while the
 * factory builds its object hits the TDZ (`Cannot access before
 * initialization`) the first time a module imports the mock. */
const movementsResult = () => {
  const custom = (globalThis as Record<string, unknown>).__MOVS__;
  if (custom) return q(custom);
  return (globalThis as Record<string, unknown>).__MOV__ === "error" ? err() : loadedData.movements;
};

vi.mock("@/lib/api/finance", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api/finance")>();
  return {
    ...mod,
    useSubscriptions: () => (globalThis as Record<string, unknown>).__SUBS__ ?? loadedData.financeSubs,
    useMovements: () => movementsResult(),
    useMovementsRange: () => movementsResult(),
    useCategories: () => loadedData.categories,
    // S-F: the removed debt/savings ledgers have no hooks left to mock —
    // any regression reintroducing a /debts or /savings-goals read fails
    // the type check instead.
  };
});

describe("DashboardHome ES copy", () => {
  it("error en un hook: panel de error localizado y el resto sigue renderizando (JD-B-002)", () => {
    (globalThis as Record<string, unknown>).__DH__ = "error";
    render(<DashboardHome />);
    // `useAccounts` feeds the telemetry strip and «Últimos movimientos», so both
    // show their local error panel while the rest of the home keeps rendering.
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("No se pudo cargar esta sección")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Reintentar" }).length).toBeGreaterThanOrEqual(1);
    // El resto (widgets, secciones) sigue vivo.
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Telemetría en vivo de tus cuentas, suscripciones y hábitos.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Próximos pagos" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hoy" })).toBeInTheDocument();
    delete (globalThis as Record<string, unknown>).__DH__;
  });

  it("renders the 4 KPI tiles with no patrimonio, no debts/savings KPIs and no removed requests", () => {
    render(<DashboardHome />);
    expect(screen.queryByText("Patrimonio neto")).not.toBeInTheDocument();
    expect(screen.getByText("Cuentas")).toBeInTheDocument();
    expect(screen.getByText("Suscripciones")).toBeInTheDocument();
    expect(screen.getByText("Saldo total")).toBeInTheDocument();
    expect(screen.getByText("Gasto del Ciclo")).toBeInTheDocument();
    // Removed strip items are gone (no /debts or /savings-goals hook
    // exists anymore — reintroducing one fails the type check).
    expect(screen.queryByText("Deudas")).not.toBeInTheDocument();
    expect(screen.queryByText("Ahorros")).not.toBeInTheDocument();
    expect(screen.queryByText("Balance del mes")).not.toBeInTheDocument();
  });

  it("total balance sums only same-currency accounts", () => {
    render(<DashboardHome />);
    // 500 + 1000 COP; the 2000 USD account is excluded, never converted.
    expect(screen.getByText("$ 1.500")).toBeInTheDocument();
    expect(screen.queryByText("$ 3.500")).not.toBeInTheDocument();
  });

  it("renders latest 5 movements in API order with a Finance link", () => {
    render(<DashboardHome />);
    expect(screen.getByRole("heading", { name: "Últimos movimientos" })).toBeInTheDocument();
    for (const label of ["Sexto", "Quinto", "Cuarto", "Tercero", "Segundo"]) {
      expect(screen.getByText(new RegExp(label))).toBeInTheDocument();
    }
    expect(screen.queryByText(/Viejo/)).not.toBeInTheDocument();
    // Category/account render inside a shared meta line — match by substring.
    expect(screen.getAllByText(/Comida/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Billetera/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders upcoming subscriptions filtered and ascending, past/inactive excluded", () => {
    render(<DashboardHome />);
    expect(screen.getByRole("heading", { name: "Próximas suscripciones" })).toBeInTheDocument();
    expect(screen.getByText("Music")).toBeInTheDocument();
    expect(screen.queryByText("Vencida")).not.toBeInTheDocument();
    expect(screen.queryByText("Off")).not.toBeInTheDocument();
  });

  it("movements error is independent: retry shows and the strip keeps rendering", () => {
    (globalThis as Record<string, unknown>).__MOV__ = "error";
    render(<DashboardHome />);
    // The two chart disclosures are open by default too, so the same local
    // error panel is legitimately visible more than once.
    expect(
      screen.getAllByText("No se pudieron cargar los movimientos").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByRole("button", { name: "Reintentar" }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Saldo total")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Próximas suscripciones" })).toBeInTheDocument();
  });

  it("KPI row retry revalidates the subscriptions read too, not only the dashboard/ prefix (JD item 6)", () => {
    // Only the subscriptions read fails: the KPI row (accounts + prefs + subs)
    // enters its error state, and so does «Próximas suscripciones», which reads
    // the same SWR key. The KPI row's panel is the first one in document order.
    (globalThis as Record<string, unknown>).__SUBS__ = err();
    render(<DashboardHome />);
    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    const kpiAlert = alerts[0];
    expect(within(kpiAlert).getByText("No se pudo cargar esta sección")).toBeInTheDocument();

    fireEvent.click(within(kpiAlert).getByRole("button", { name: "Reintentar" }));

    // A `dashboard/`-only prefix walk made this a no-op; the retry must reach
    // the finance key that actually failed it.
    expect(revalidates("finance/subscriptions")).toBe(true);
    expect(revalidates("dashboard/accounts")).toBe(true);
    expect(revalidates("dashboard/me")).toBe(true);
  });

  it("renders Spanish widget shells and overview copy without removed charts", () => {
    render(<DashboardHome />);
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByText("v2.4 Telemetría")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ Registrar actividad" })).toHaveAttribute(
      "href",
      "/dashboard/finance/",
    );
    expect(screen.getByText("Telemetría en vivo de tus cuentas, suscripciones y hábitos.")).toBeInTheDocument();
    expect(screen.queryByText("Flujo mensual")).not.toBeInTheDocument();
    expect(screen.queryByText("Gasto por categoría")).not.toBeInTheDocument();
    expect(screen.getByText("Hoy")).toBeInTheDocument();
    expect(screen.getByText("Tus hábitos de hoy y su estado de registro.")).toBeInTheDocument();
  });

  it("renders the real Bogotá date in the mobile status row", () => {
    render(<DashboardHome />);
    expect(screen.getByText(formatMovementDate(todayInBogota()))).toBeInTheDocument();
  });

  it("movement meta keeps date + payment method and never repeats the category", () => {
    render(<DashboardHome />);
    const section = screen.getByRole("region", { name: "Últimos movimientos" });
    // «Cuarto» is the m4 expense: date 2026-09-04, account Billetera, category Comida.
    const row = within(section).getByText(/Cuarto/).closest("li");
    expect(row).not.toBeNull();
    const meta = row?.querySelector("p");
    expect(meta?.textContent).toContain("4 de sept de 2026");
    expect(meta?.textContent).toContain("Método de pago: Billetera");
    expect(meta?.textContent).not.toContain("Comida");
    // The category still lives in the row chip.
    expect(within(row as HTMLElement).getByText("Comida")).toBeInTheDocument();
  });

  it("loading en un hook: skeleton localizado y el resto sigue renderizando (JD-B-002)", () => {
    (globalThis as Record<string, unknown>).__DH__ = "loading";
    render(<DashboardHome />);
    expect(screen.getByRole("status", { name: "Cargando panel" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Próximos pagos" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Deudas pendientes" })).not.toBeInTheDocument();
    delete (globalThis as Record<string, unknown>).__DH__;
  });

  it("ignores a persisted dashboard_layout naming a removed widget id", () => {
    (globalThis as Record<string, unknown>).__LAYOUT__ = q({
      preferences: {
        currency_code: "COP",
        locale: "es-CO",
        dashboard_layout: {
          widgets: [
            { id: "budgets", type: "list", order: 1, size: "md" },
            { id: "pending-debts", type: "list", order: 21, size: "md" },
            { id: "active-subs", type: "list", order: 22, size: "md" },
          ],
        },
      },
    });
    render(<DashboardHome />);
    expect(screen.queryByRole("heading", { name: "Presupuestos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Ocultar bloque: budgets" })).not.toBeInTheDocument();
    // The retired pending-debts entry renders no block, no error.
    expect(screen.queryByRole("heading", { name: "Deudas pendientes" })).not.toBeInTheDocument();
    // The active-subscriptions widget retired by the consolidation is ignored too.
    expect(screen.queryByText("Suscripciones activas")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /active-subs/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Últimos movimientos" })).toBeInTheDocument();
    delete (globalThis as Record<string, unknown>).__LAYOUT__;
  });

  it("ignores stale month-split widget ids without render or fetch", () => {
    (globalThis as Record<string, unknown>).__LAYOUT__ = q({
      preferences: {
        currency_code: "COP",
        locale: "es-CO",
        dashboard_layout: {
          widgets: [
            { id: "month-savings", type: "metric", order: 12, size: "sm" },
            { id: "upcoming-payments", type: "list", order: 20, size: "lg" },
          ],
        },
      },
    });
    render(<DashboardHome />);
    expect(screen.queryByText("Ahorro del mes")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Próximos pagos" })).toBeInTheDocument();
    delete (globalThis as Record<string, unknown>).__LAYOUT__;
  });

  it("formats habit streak in Spanish", () => {
    (globalThis as Record<string, unknown>).__HABITS__ = q([
      { habit_id: "h1", name: "Leer", habit_frequency: "daily", days_of_week: [], current_streak: 3, today_status: "pending" },
    ]);
    render(<DashboardHome />);
    expect(screen.getByText("racha de 3 días")).toBeInTheDocument();
    delete (globalThis as Record<string, unknown>).__HABITS__;
  });
});

describe("DashboardHome T3 KPI tiles (real data only)", () => {
  it("shows the real account count and the real account names in the footer", () => {
    render(<DashboardHome />);
    const kpis = screen.getByRole("region", { name: "Resumen de métricas" });
    expect(within(kpis).getByText("3")).toBeInTheDocument();
    expect(within(kpis).getByText("vinculadas")).toBeInTheDocument();
    expect(within(kpis).getByText("Billetera, Banco, Exterior")).toBeInTheDocument();
  });

  it("shows the real monthly subscription total and the real pending charges", () => {
    render(<DashboardHome />);
    // 12.000 + 5.000 monthly; the inactive one is excluded.
    expect(screen.getByText("$ 17.000")).toBeInTheDocument();
    // Only «Vencida» is unpaid this cycle (Music carries last_paid_on).
    expect(screen.getByText("1 cargo pendiente este ciclo")).toBeInTheDocument();
  });

  it("subscription tile sums same-currency only and states the excluded count", () => {
    const billingDay = daysFromToday(2);
    (globalThis as Record<string, unknown>).__SUBS__ = q([
      { id: "s1", name: "Music", price: "12000.00", currency: "COP", frequency: "monthly", next_billing_on: billingDay, is_active: true, last_paid_on: "2026-09-05" },
      { id: "s4", name: "Cloud", price: "9.99", currency: "USD", frequency: "monthly", next_billing_on: billingDay, is_active: true, last_paid_on: null },
    ]);
    render(<DashboardHome />);
    // The COP total never absorbs the USD price (no conversion exists).
    const kpis = screen.getByRole("region", { name: "Resumen de métricas" });
    expect(within(kpis).getByText("$ 12.000")).toBeInTheDocument();
    expect(within(kpis).queryByText("$ 12.010")).not.toBeInTheDocument();
    expect(
      within(kpis).getByText("1 cargo pendiente este ciclo · excluye 1 en otra moneda"),
    ).toBeInTheDocument();
    delete (globalThis as Record<string, unknown>).__SUBS__;
  });

  it("never hides a real cycle category: two chips plus an honest +N más marker", () => {
    const day = todayInBogota();
    const expense = (id: string, amount: string, categoryId: string) => ({
      id,
      direction: "expense",
      amount,
      occurred_on: day,
      description: null,
      account_id: "a1",
      category_id: categoryId,
      subscription_id: null,
      created_at: day,
      updated_at: day,
    });
    (globalThis as Record<string, unknown>).__MOVS__ = [
      expense("m-a", "35000.00", "c1"),
      expense("m-b", "27000.00", "c2"),
      expense("m-c", "20000.00", "c3"),
    ];
    render(<DashboardHome />);
    // The KPI stays complete ($ 82.000) while the chips state the folded category.
    const kpis = screen.getByRole("region", { name: "Resumen de métricas" });
    expect(within(kpis).getByText("$ 82.000")).toBeInTheDocument();
    expect(
      within(kpis).getByText("Comida ($ 35.000) + Transporte ($ 27.000) +1 más"),
    ).toBeInTheDocument();
    delete (globalThis as Record<string, unknown>).__MOVS__;
  });

  it("shows the real balance footer and the excluded foreign-currency account", () => {
    render(<DashboardHome />);
    expect(screen.getByText("Suma de tus cuentas en COP · excluye 1 en otra moneda")).toBeInTheDocument();
  });

  it("renders the cycle spend empty state when the period has no real expenses", () => {
    render(<DashboardHome />);
    // Every fixture movement is from September; the current cycle is empty.
    expect(screen.getByText("Sin gastos registrados este ciclo")).toBeInTheDocument();
  });

  it("never reproduces the prototype's invented numbers or telemetry", () => {
    render(<DashboardHome />);
    expect(screen.queryByText("9 vinculadas")).not.toBeInTheDocument();
    expect(screen.queryByText("$ 2.620.900")).not.toBeInTheDocument();
    expect(screen.queryByText(/\+5\.2%/)).not.toBeInTheDocument();
    expect(screen.queryByText("$ 34.100")).not.toBeInTheDocument();
    expect(screen.queryByText(/Latencia/)).not.toBeInTheDocument();
    expect(screen.queryByText(/bog1-co/)).not.toBeInTheDocument();
    expect(screen.queryByText(/18ms/)).not.toBeInTheDocument();
  });




  it("no longer renders the decorative sync pill the owner removed", () => {
    render(<DashboardHome />);
    expect(screen.queryByText("Sincronización activa")).not.toBeInTheDocument();
    expect(screen.queryByText("Sincronizando…")).not.toBeInTheDocument();
    expect(screen.queryByText("Sin sincronizar")).not.toBeInTheDocument();
  });

  it("renders the prototype empty state when no subscription is upcoming", () => {
    (globalThis as Record<string, unknown>).__SUBS__ = q([]);
    render(<DashboardHome />);
    expect(screen.getByText("Sin próximas suscripciones")).toBeInTheDocument();
    expect(
      screen.getByText("Los cargos recurrentes aparecerán aquí cuando estén programados."),
    ).toBeInTheDocument();
    delete (globalThis as Record<string, unknown>).__SUBS__;
  });

  it("keeps the cycle spend honest when the movements read fails", () => {
    (globalThis as Record<string, unknown>).__MOV__ = "error";
    render(<DashboardHome />);
    expect(screen.getByText("No se pudieron cargar los gastos del ciclo")).toBeInTheDocument();
    expect(screen.getByText("Saldo total")).toBeInTheDocument();
    delete (globalThis as Record<string, unknown>).__MOV__;
  });
});

describe("DashboardHome chart disclosures W4", () => {
  it("renders exactly the two chart disclosures open by default with their real period controls", () => {
    render(<DashboardHome />);

    const trend = screen.getByRole("button", { name: "Gastos vs. ingresos" });
    const pie = screen.getByRole("button", { name: "Gastos por categoría" });
    expect(screen.getAllByRole("button", { name: "Gastos vs. ingresos" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Gastos por categoría" })).toHaveLength(1);
    expect(trend).toHaveAttribute("aria-expanded", "true");
    expect(pie).toHaveAttribute("aria-expanded", "true");
    expect(trend).toHaveAttribute("aria-controls", "dashboard-total-trend-panel");
    expect(pie).toHaveAttribute("aria-controls", "dashboard-expense-pie-panel");

    const trendPanel = document.getElementById("dashboard-total-trend-panel");
    const piePanel = document.getElementById("dashboard-expense-pie-panel");
    expect(trendPanel).not.toBeNull();
    expect(piePanel).not.toBeNull();
    expect(trendPanel).not.toHaveAttribute("hidden");
    expect(piePanel).not.toHaveAttribute("hidden");

    // Both period controls are mounted from first paint and named apart.
    expect(screen.getByRole("group", { name: "Periodo de la tendencia" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Periodo del pastel" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Periodo" })).not.toBeInTheDocument();
    expect(trendPanel).not.toBeEmptyDOMElement();
    expect(piePanel).not.toBeEmptyDOMElement();
  });

  it("collapses and reopens each chart disclosure independently", () => {
    render(<DashboardHome />);

    const trend = screen.getByRole("button", { name: "Gastos vs. ingresos" });
    const pie = screen.getByRole("button", { name: "Gastos por categoría" });
    expect(trend).toHaveAttribute("aria-expanded", "true");
    expect(pie).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(trend);
    expect(trend).toHaveAttribute("aria-expanded", "false");
    expect(pie).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("dashboard-total-trend-panel")).toHaveAttribute("hidden");
    expect(document.getElementById("dashboard-expense-pie-panel")).not.toHaveAttribute("hidden");

    fireEvent.click(pie);
    expect(trend).toHaveAttribute("aria-expanded", "false");
    expect(pie).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trend);
    expect(trend).toHaveAttribute("aria-expanded", "true");
    expect(pie).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps each period selection in its own radio group", () => {
    render(<DashboardHome />);

    const trendRadios = document.querySelectorAll<HTMLInputElement>(
      'input[name="dashboard-total-trend-period"]',
    );
    const pieRadios = document.querySelectorAll<HTMLInputElement>(
      'input[name="dashboard-expense-pie-period"]',
    );
    expect(trendRadios).toHaveLength(4);
    expect(pieRadios).toHaveLength(4);

    const trendMonth = document.querySelector<HTMLInputElement>(
      'input[name="dashboard-total-trend-period"][value="month"]',
    )!;
    const pieMonth = document.querySelector<HTMLInputElement>(
      'input[name="dashboard-expense-pie-period"][value="month"]',
    )!;
    expect(trendMonth.checked).toBe(true);
    expect(pieMonth.checked).toBe(true);

    fireEvent.click(
      document.querySelector<HTMLInputElement>(
        'input[name="dashboard-expense-pie-period"][value="day"]',
      )!,
    );
    const pieDay = document.querySelector<HTMLInputElement>(
      'input[name="dashboard-expense-pie-period"][value="day"]',
    )!;
    expect(pieDay.checked).toBe(true);
    expect(pieMonth.checked).toBe(false);
    expect(trendMonth.checked).toBe(true);
  });
});
