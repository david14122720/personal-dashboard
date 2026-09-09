import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DashboardHome from "./DashboardHome";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate: vi.fn() }) }));

const q = (data: unknown) => ({ data, error: undefined, isLoading: false });

const loadedData = {
  netWorth: q({ per_currency: [{ currency: "COP", assets: "100", debts: "20", net_worth: "80" }] }),
  flow: q([{ month: "2026-09", income: "100", expense: "50" }]),
  categories: q([]),
  budgets: q([]),
  habits: q([]),
  accounts: q([]),
  prefs: q({ preferences: { currency_code: "COP", locale: "es-CO" } }),
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
  useMonthlyFlow: () => loadedData.flow,
  useSpendByCategory: () => loadedData.categories,
  useBudgets: () => loadedData.budgets,
  useHabitsToday: () => (globalThis as Record<string, unknown>).__HABITS__ ?? loadedData.habits,
  useAccounts: () => loadedData.accounts,
  usePreferences: () => loadedData.prefs,
  useUpdateLayout: () => async () => {},
  };
});

describe("DashboardHome ES copy", () => {
  it("shows Spanish error with retry", () => {
    (globalThis as Record<string, unknown>).__DH__ = "error";
    render(<DashboardHome />);
    expect(screen.getByText("No se pudo cargar el panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    delete (globalThis as Record<string, unknown>).__DH__;
  });

  it("renders Spanish telemetry and empty habits", () => {
    render(<DashboardHome />);
    expect(screen.getAllByText("Patrimonio neto").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Hábitos pendientes")).toBeInTheDocument();
    expect(screen.getByText("Todo al día por hoy")).toBeInTheDocument();
    expect(screen.getByText("Nada pendiente")).toBeInTheDocument();
  });

  it("renders Spanish widget shells and overview copy", () => {
    render(<DashboardHome />);
    expect(screen.getByRole("heading", { name: "Resumen" })).toBeInTheDocument();
    expect(screen.getByText("Telemetría en vivo de tus cuentas, presupuestos y hábitos.")).toBeInTheDocument();
    expect(screen.getByText("Flujo mensual")).toBeInTheDocument();
    expect(screen.getByText("Ingresos frente a gastos, últimos 12 meses.")).toBeInTheDocument();
    expect(screen.getByText("Gasto por categoría")).toBeInTheDocument();
    expect(screen.getByText("Gastos del mes actual.")).toBeInTheDocument();
    expect(screen.getByText("Fracción gastada por presupuesto activo.")).toBeInTheDocument();
    expect(screen.getByText("Hoy")).toBeInTheDocument();
    expect(screen.getByText("Hábitos pendientes de registro.")).toBeInTheDocument();
    expect(screen.getByText("0 días")).toBeInTheDocument();
  });

  it("shows Spanish loading state", () => {
    (globalThis as Record<string, unknown>).__DH__ = "loading";
    render(<DashboardHome />);
    expect(screen.getByRole("status", { name: "Cargando panel" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Resumen" })).toBeInTheDocument();
    delete (globalThis as Record<string, unknown>).__DH__;
  });

  it("formats habit streak in Spanish", () => {
    (globalThis as Record<string, unknown>).__HABITS__ = q([
      { habit_id: "h1", name: "Leer", habit_frequency: "daily", days_of_week: [], current_streak: 3, today_status: "pending" },
    ]);
    render(<DashboardHome />);
    expect(screen.getByText("racha de 3 días")).toBeInTheDocument();
    expect(screen.getByText("3 días")).toBeInTheDocument();
    delete (globalThis as Record<string, unknown>).__HABITS__;
  });
});
