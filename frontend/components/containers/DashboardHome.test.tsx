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

const loadedData = {
  netWorth: q({ per_currency: [{ currency: "COP", assets: "100", debts: "20", net_worth: "80" }] }),
  habits: q([]),
  accounts: q([
    { id: "a1", name: "Billetera", type: "cash", currency: "COP", balance: "500.00" },
    { id: "a2", name: "Banco", type: "bank", currency: "COP", balance: "1000.00" },
  ]),
  prefs: q({ preferences: { currency_code: "COP", locale: "es-CO" } }),
  financeSubs: q([
    { id: "s1", name: "Music", price: "12000.00", currency: "COP", frequency: "monthly", next_billing_on: null, is_active: true },
  ]),
  financeDebts: q([
    { id: "d1", name: "Loan", creditor: "Bank", original_amount: "500.00", pending_amount: "320.00", currency: "COP", status: "active", due_date: null },
  ]),
  financeSavings: q([
    { id: "g1", name: "Trip", target_amount: "1000.00", saved_amount: "250.00", currency: "COP", is_completed: false, target_date: null },
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
  useDebts: () => q([]), useSubscriptions: () => q([]), useTasks: () => q([]), useEvents: () => q([]), useGoals: () => q([]), useSavingsGoals: () => q([]),
  useUpdateLayout: () => async () => {},
  };
});

vi.mock("@/lib/api/finance", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api/finance")>();
  return {
    ...mod,
    useSubscriptions: () => loadedData.financeSubs,
    useDebts: () => loadedData.financeDebts,
    useSavingsGoals: () => loadedData.financeSavings,
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
    expect(screen.getByText("Telemetría en vivo de tus cuentas, deudas y hábitos.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Próximos pagos" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hoy" })).toBeInTheDocument();
    delete (globalThis as Record<string, unknown>).__DH__;
  });

  it("renders the 5-KPI strip from live sources only", () => {
    render(<DashboardHome />);
    expect(screen.getAllByText("Patrimonio neto").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Cuentas")).toBeInTheDocument();
    expect(screen.getByText("Suscripciones")).toBeInTheDocument();
    expect(screen.getByText("Deudas")).toBeInTheDocument();
    expect(screen.getByText("Ahorros")).toBeInTheDocument();
    // Removed strip items are gone.
    expect(screen.queryByText("Balance del mes")).not.toBeInTheDocument();
    expect(screen.queryByText("Tasa de ahorro")).not.toBeInTheDocument();
    expect(screen.queryByText("Racha más larga")).not.toBeInTheDocument();
  });

  it("renders Spanish widget shells and overview copy without removed charts", () => {
    render(<DashboardHome />);
    expect(screen.getByRole("heading", { name: /Resumen General/ })).toBeInTheDocument();
    expect(screen.queryByText("v2.4 Telemetría")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ Registrar actividad" })).toHaveAttribute(
      "href",
      "/dashboard/finance/",
    );
    expect(screen.getByText("Telemetría en vivo de tus cuentas, deudas y hábitos.")).toBeInTheDocument();
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
    expect(screen.getByRole("heading", { name: "Deudas pendientes" })).toBeInTheDocument();
    delete (globalThis as Record<string, unknown>).__DH__;
  });

  it("ignores a persisted dashboard_layout naming a removed widget id (S2 budgets)", () => {
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
    expect(screen.getByRole("heading", { name: /Resumen General/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Deudas pendientes" })).toBeInTheDocument();
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
            { id: "pending-debts", type: "list", order: 21, size: "md" },
          ],
        },
      },
    });
    render(<DashboardHome />);
    expect(screen.queryByText("Ahorro del mes")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Deudas pendientes" })).toBeInTheDocument();
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
