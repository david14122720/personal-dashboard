import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DashboardHome from "./DashboardHome";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const q = (data: unknown) => ({ data, error: undefined, isLoading: false });
const err = () => ({ data: undefined, error: new Error("boom"), isLoading: false });

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
    { id: "s1", name: "Music", price: "12000.00", currency: "COP", frequency: "monthly", next_billing_on: "2026-10-05", is_active: true, last_paid_on: "2026-09-05" },
    { id: "s2", name: "Vencida", price: "5000.00", currency: "COP", frequency: "monthly", next_billing_on: "2026-08-01", is_active: true, last_paid_on: null },
    { id: "s3", name: "Off", price: "7000.00", currency: "COP", frequency: "monthly", next_billing_on: "2026-10-05", is_active: false, last_paid_on: null },
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
  ]),
};

vi.mock("@/lib/api/dashboard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api/dashboard")>();
  return {
    ...mod,
  useNetWorth: () => (globalThis as Record<string, unknown>).__DH__ === "error"
    ? { data: undefined, error: new Error("boom"), isLoading: false }
    : (globalThis as Record<string, unknown>).__DH__ === "loading"
      ? { data: undefined, error: undefined, isLoading: true }
      : loadedData.netWorth,
  useHabitsToday: () => (globalThis as Record<string, unknown>).__HABITS__ ?? loadedData.habits,
  useAccounts: () => loadedData.accounts,
  usePreferences: () => (globalThis as Record<string, unknown>).__LAYOUT__ ?? loadedData.prefs,
  useSubscriptions: () => q([]), useTasks: () => q([]), useEvents: () => q([]), useGoals: () => q([]),
  useUpdateLayout: () => async () => {},
  };
});

vi.mock("@/lib/api/finance", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api/finance")>();
  return {
    ...mod,
    useSubscriptions: () => loadedData.financeSubs,
    useMovements: () => (globalThis as Record<string, unknown>).__MOV__ === "error" ? err() : loadedData.movements,
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
    // Panel de error SOLO en la sección que falló (telemetría), no toda la home.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("No se pudo cargar esta sección")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    // El resto (widgets, secciones) sigue vivo.
    expect(screen.getByRole("heading", { name: /Resumen General/ })).toBeInTheDocument();
    expect(screen.getByText("Telemetría en vivo de tus cuentas, suscripciones y hábitos.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Próximos pagos" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hoy" })).toBeInTheDocument();
    delete (globalThis as Record<string, unknown>).__DH__;
  });

  it("renders the 4-KPI strip with no debts/savings KPIs and no removed requests", () => {
    render(<DashboardHome />);
    expect(screen.getAllByText("Patrimonio neto").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Cuentas")).toBeInTheDocument();
    expect(screen.getByText("Suscripciones")).toBeInTheDocument();
    expect(screen.getByText("Saldo total")).toBeInTheDocument();
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
    expect(screen.getByText("No se pudieron cargar los movimientos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.getAllByText("Patrimonio neto").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("heading", { name: "Próximas suscripciones" })).toBeInTheDocument();
    delete (globalThis as Record<string, unknown>).__MOV__;
  });

  it("renders Spanish widget shells and overview copy without removed charts", () => {
    render(<DashboardHome />);
    expect(screen.getByRole("heading", { name: /Resumen General/ })).toBeInTheDocument();
    expect(screen.queryByText("v2.4 Telemetría")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ Registrar actividad" })).toHaveAttribute(
      "href",
      "/dashboard/finance/",
    );
    expect(screen.getByText("Telemetría en vivo de tus cuentas, suscripciones y hábitos.")).toBeInTheDocument();
    expect(screen.queryByText("Flujo mensual")).not.toBeInTheDocument();
    expect(screen.queryByText("Gasto por categoría")).not.toBeInTheDocument();
    expect(screen.getByText("Hoy")).toBeInTheDocument();
    expect(screen.getByText("Hábitos pendientes de registro.")).toBeInTheDocument();
  });

  it("loading en un hook: skeleton localizado y el resto sigue renderizando (JD-B-002)", () => {
    (globalThis as Record<string, unknown>).__DH__ = "loading";
    render(<DashboardHome />);
    expect(screen.getByRole("status", { name: "Cargando panel" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Resumen General/ })).toBeInTheDocument();
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
          ],
        },
      },
    });
    render(<DashboardHome />);
    expect(screen.queryByRole("heading", { name: "Presupuestos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Ocultar bloque: budgets" })).not.toBeInTheDocument();
    // The retired pending-debts entry renders no block, no error.
    expect(screen.queryByRole("heading", { name: "Deudas pendientes" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Resumen General/ })).toBeInTheDocument();
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
