import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryWire, MovementWire } from "@/lib/api/finance";
import ExpensePieSection from "./ExpensePieSection";
import TotalTrendSection from "./TotalTrendSection";

const mock = vi.hoisted(() => ({
  movements: vi.fn(),
  accounts: vi.fn(),
  categories: vi.fn(),
  prefs: vi.fn(),
  mutate: vi.fn(),
  chart: { current: null as Record<string, unknown> | null },
}));

vi.mock("next/dynamic", () => ({
  default: () => (props: Record<string, unknown>) => {
    mock.chart.current = props;
    return <div data-testid="dynamic-chart" />;
  },
}));

vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate: mock.mutate }) }));

vi.mock("@/lib/api/finance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/finance")>()),
  useMovements: () => mock.movements(),
  useCategories: () => mock.categories(),
}));

vi.mock("@/lib/api/dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/dashboard")>()),
  useAccounts: () => mock.accounts(),
  usePreferences: () => mock.prefs(),
}));

const NOW = new Date(2026, 9, 15, 12, 0, 0); // jueves 15 de octubre de 2026

const account = { id: "a1", name: "Billetera", type: "cash", currency: "COP", balance: "0.00" };

function movement(overrides: Partial<MovementWire> = {}): MovementWire {
  return {
    id: "m1",
    direction: "expense",
    amount: "100.00",
    occurred_on: "2026-10-15",
    description: null,
    account_id: "a1",
    category_id: "c1",
    subscription_id: null,
    created_at: "2026-10-15T10:00:00Z",
    updated_at: "2026-10-15T10:00:00Z",
    ...overrides,
  };
}

function category(id: string, name: string): CategoryWire {
  return {
    id,
    kind: "finance",
    name,
    color: null,
    icon: null,
    is_archived: false,
    created_at: "2026-10-01T00:00:00Z",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mock.chart.current = null;
  mock.movements.mockReturnValue({
    data: [
      movement({ id: "m1", category_id: "c1", amount: "100.00", occurred_on: "2026-10-15" }),
      movement({ id: "m2", category_id: "c2", amount: "50.00", occurred_on: "2026-10-02" }),
    ],
    error: undefined,
    isLoading: false,
  });
  mock.accounts.mockReturnValue({ data: [account], error: undefined, isLoading: false });
  mock.categories.mockReturnValue({
    data: [category("c1", "Comida"), category("c2", "Transporte")],
    error: undefined,
    isLoading: false,
  });
  mock.prefs.mockReturnValue({
    data: { preferences: { currency_code: "COP", locale: "es-CO" } },
    error: undefined,
    isLoading: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function renderOpen() {
  render(<ExpensePieSection />);
  fireEvent.click(screen.getByRole("button", { name: "Gastos por categoría" }));
}

describe("ExpensePieSection", () => {
  it("arranca colapsada y no monta los hooks de datos ni el panel", () => {
    render(<ExpensePieSection />);
    const trigger = screen.getByRole("button", { name: "Gastos por categoría" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Periodo" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("dynamic-chart")).not.toBeInTheDocument();
    expect(mock.movements).not.toHaveBeenCalled();
    expect(mock.accounts).not.toHaveBeenCalled();
    expect(mock.categories).not.toHaveBeenCalled();
    expect(mock.prefs).not.toHaveBeenCalled();
  });

  it("abre con el periodo Mes por defecto y monta los hooks recién ahí", () => {
    renderOpen();
    expect(screen.getByRole("button", { name: "Gastos por categoría" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Mes" })).toBeChecked();
    expect(mock.movements).toHaveBeenCalledTimes(1);
    expect(mock.accounts).toHaveBeenCalledTimes(1);
    expect(mock.categories).toHaveBeenCalledTimes(1);
    expect(mock.prefs).toHaveBeenCalledTimes(1);
    expect(mock.chart.current?.data).toEqual([
      { categoryId: "c1", name: "Comida", value: 100 },
      { categoryId: "c2", name: "Transporte", value: 50 },
    ]);
    expect(mock.chart.current?.currency).toBe("COP");
    expect(mock.chart.current?.locale).toBe("es-CO");
    expect(mock.chart.current?.ariaLabel).toBe("Gastos por categoría en el periodo actual");
    expect(mock.chart.current?.animate).toBe(true);
  });

  it("bautiza su grupo de radio con el nombre del panel del pastel", () => {
    renderOpen();
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("name"))).toEqual([
      "dashboard-expense-pie-period",
      "dashboard-expense-pie-period",
      "dashboard-expense-pie-period",
      "dashboard-expense-pie-period",
    ]);
  });

  it("recalcula el rango del periodo actual (día/semana/mes/año)", () => {
    renderOpen();
    expect(mock.chart.current?.data).toHaveLength(2);

    fireEvent.click(screen.getByRole("radio", { name: "Día" }));
    expect(mock.chart.current?.data).toEqual([{ categoryId: "c1", name: "Comida", value: 100 }]);

    fireEvent.click(screen.getByRole("radio", { name: "Semana" }));
    expect(mock.chart.current?.data).toEqual([{ categoryId: "c1", name: "Comida", value: 100 }]);

    fireEvent.click(screen.getByRole("radio", { name: "Año" }));
    expect(mock.chart.current?.data).toHaveLength(2);
  });

  it("excluye categorías que no vienen de la API persistida", () => {
    mock.movements.mockReturnValue({
      data: [
        movement({ id: "local", category_id: "local-only", amount: "999.00" }),
        movement({ id: "m1", category_id: "c1", amount: "100.00" }),
      ],
      error: undefined,
      isLoading: false,
    });
    mock.categories.mockReturnValue({
      data: [category("c1", "Comida")],
      error: undefined,
      isLoading: false,
    });
    renderOpen();
    expect(mock.chart.current?.data).toEqual([
      { categoryId: "c1", name: "Comida", value: 100 },
    ]);
  });

  it("muestra el estado de carga en español", () => {
    mock.categories.mockReturnValue({ data: undefined, error: undefined, isLoading: true });
    renderOpen();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
    expect(screen.queryByTestId("dynamic-chart")).not.toBeInTheDocument();
  });

  it("muestra el error en español y reintenta las cuatro lecturas SWR", () => {
    mock.categories.mockReturnValue({
      data: undefined,
      error: new Error("boom"),
      isLoading: false,
    });
    renderOpen();
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar los movimientos");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(mock.mutate).toHaveBeenCalledWith("finance/movements");
    expect(mock.mutate).toHaveBeenCalledWith("dashboard/accounts");
    expect(mock.mutate).toHaveBeenCalledWith("finance/categories");
    expect(mock.mutate).toHaveBeenCalledWith("dashboard/me");
  });

  it("al colapsar desmonta el panel pero deja el destino de aria-controls", () => {
    renderOpen();
    fireEvent.click(screen.getByRole("button", { name: "Gastos por categoría" }));
    expect(screen.queryByTestId("dynamic-chart")).not.toBeInTheDocument();
    const panel = document.getElementById("dashboard-expense-pie-panel");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("hidden");
  });

  it("conserva el periodo elegido al colapsar y reabrir", () => {
    renderOpen();
    fireEvent.click(screen.getByRole("radio", { name: "Día" }));
    expect(mock.chart.current?.data).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Gastos por categoría" }));
    fireEvent.click(screen.getByRole("button", { name: "Gastos por categoría" }));
    expect(screen.getByRole("radio", { name: "Día" })).toBeChecked();
    expect(mock.chart.current?.data).toHaveLength(1);
  });

  it("suprime la animación cuando el usuario prefiere menos movimiento", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    renderOpen();
    expect(mock.chart.current?.animate).toBe(false);
    vi.unstubAllGlobals();
  });

  it("distingue por nombre accesible los dos grupos de periodo con ambos paneles abiertos", () => {
    render(
      <>
        <TotalTrendSection />
        <ExpensePieSection />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Gastos vs. ingresos" }));
    fireEvent.click(screen.getByRole("button", { name: "Gastos por categoría" }));

    const trendGroup = screen.getByRole("group", { name: "Periodo de la tendencia" });
    const pieGroup = screen.getByRole("group", { name: "Periodo del pastel" });
    expect(within(trendGroup).getByRole("radio", { name: "Mes" })).toBeChecked();
    expect(within(pieGroup).getByRole("radio", { name: "Mes" })).toBeChecked();
    expect(screen.queryByRole("group", { name: "Periodo" })).not.toBeInTheDocument();
  });

  it("convive con la tendencia total: grupos de radio distintos y sin acoplarse", () => {
    render(
      <>
        <TotalTrendSection />
        <ExpensePieSection />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Gastos vs. ingresos" }));
    fireEvent.click(screen.getByRole("button", { name: "Gastos por categoría" }));

    const trendRadios = document.querySelectorAll('input[name="dashboard-total-trend-period"]');
    const pieRadios = document.querySelectorAll('input[name="dashboard-expense-pie-period"]');
    expect(trendRadios).toHaveLength(4);
    expect(pieRadios).toHaveLength(4);

    const trendMonth = document.querySelector<HTMLInputElement>(
      'input[name="dashboard-total-trend-period"][value="month"]',
    );
    const pieMonth = document.querySelector<HTMLInputElement>(
      'input[name="dashboard-expense-pie-period"][value="month"]',
    );
    expect(trendMonth?.checked).toBe(true);
    expect(pieMonth?.checked).toBe(true);

    const pieDay = document.querySelector<HTMLInputElement>(
      'input[name="dashboard-expense-pie-period"][value="day"]',
    )!;
    fireEvent.click(pieDay);

    expect(pieDay.checked).toBe(true);
    expect(pieMonth?.checked).toBe(false);
    expect(trendMonth?.checked).toBe(true);
  });
});
