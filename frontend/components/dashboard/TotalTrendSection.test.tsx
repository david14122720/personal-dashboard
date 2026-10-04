import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MovementWire } from "@/lib/api/finance";
import TotalTrendSection from "./TotalTrendSection";

const mock = vi.hoisted(() => ({
  movements: vi.fn(),
  accounts: vi.fn(),
  prefs: vi.fn(),
  mutate: vi.fn(),
  chart: { current: null as Record<string, unknown> | null },
}));

vi.mock("next/dynamic", () => ({
  default: () => (props: Record<string, unknown>) => {
    mock.chart.current = props;
    return <div data-testid="total-trend-chart" />;
  },
}));

vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate: mock.mutate }) }));

vi.mock("@/lib/api/finance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/finance")>()),
  useMovements: () => mock.movements(),
}));

vi.mock("@/lib/api/dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/dashboard")>()),
  useAccounts: () => mock.accounts(),
  usePreferences: () => mock.prefs(),
}));

const account = { id: "a1", name: "Billetera", type: "cash", currency: "COP", balance: "0.00" };

function movement(overrides: Partial<MovementWire> = {}): MovementWire {
  return {
    id: "m1",
    direction: "expense",
    amount: "100.00",
    occurred_on: "2026-10-03",
    description: null,
    account_id: "a1",
    category_id: "c1",
    subscription_id: null,
    created_at: "2026-10-03T10:00:00Z",
    updated_at: "2026-10-03T10:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.chart.current = null;
  mock.movements.mockReturnValue({ data: [movement()], error: undefined, isLoading: false });
  mock.accounts.mockReturnValue({ data: [account], error: undefined, isLoading: false });
  mock.prefs.mockReturnValue({
    data: { preferences: { currency_code: "COP", locale: "es-CO" } },
    error: undefined,
    isLoading: false,
  });
});

function renderOpen() {
  render(<TotalTrendSection />);
  fireEvent.click(screen.getByRole("button", { name: "Gastos vs. ingresos" }));
}

describe("TotalTrendSection", () => {
  it("arranca colapsada y no monta los hooks de datos ni el panel", () => {
    render(<TotalTrendSection />);
    const trigger = screen.getByRole("button", { name: "Gastos vs. ingresos" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Periodo" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("total-trend-chart")).not.toBeInTheDocument();
    expect(mock.movements).not.toHaveBeenCalled();
    expect(mock.accounts).not.toHaveBeenCalled();
    expect(mock.prefs).not.toHaveBeenCalled();
  });

  it("abre con el periodo Mes por defecto y monta los hooks recién ahí", () => {
    renderOpen();
    expect(screen.getByRole("button", { name: "Gastos vs. ingresos" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Mes" })).toBeChecked();
    expect(mock.movements).toHaveBeenCalledTimes(1);
    expect(mock.accounts).toHaveBeenCalledTimes(1);
    expect(mock.prefs).toHaveBeenCalledTimes(1);
    expect(mock.chart.current?.data).toHaveLength(12);
  });

  it("bautiza su grupo de radio con el nombre del panel total", () => {
    renderOpen();
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("name"))).toEqual([
      "dashboard-total-trend-period",
      "dashboard-total-trend-period",
      "dashboard-total-trend-period",
      "dashboard-total-trend-period",
    ]);
  });

  it("cambia el número de buckets por periodo (14/8/12/5)", () => {
    renderOpen();
    expect(mock.chart.current?.data).toHaveLength(12);
    fireEvent.click(screen.getByRole("radio", { name: "Día" }));
    expect(mock.chart.current?.data).toHaveLength(14);
    fireEvent.click(screen.getByRole("radio", { name: "Semana" }));
    expect(mock.chart.current?.data).toHaveLength(8);
    fireEvent.click(screen.getByRole("radio", { name: "Año" }));
    expect(mock.chart.current?.data).toHaveLength(5);
  });

  it("pasa las dos series con las etiquetas existentes y la moneda del usuario", () => {
    renderOpen();
    expect(mock.chart.current?.series).toEqual([
      { key: "expense", label: "Gastos", token: "--color-signal" },
      { key: "income", label: "Ingresos", token: "--color-flow" },
    ]);
    expect(mock.chart.current?.currency).toBe("COP");
    expect(mock.chart.current?.locale).toBe("es-CO");
    expect(mock.chart.current?.ariaLabel).toBe("Gastos e ingresos por periodo");
    expect(mock.chart.current?.animate).toBe(true);
  });

  it("muestra la nota en cero nombrando la moneda del usuario en el periodo", () => {
    mock.movements.mockReturnValue({ data: [], error: undefined, isLoading: false });
    renderOpen();
    expect(screen.getByText("Sin movimientos en COP en este periodo")).toBeInTheDocument();
    expect(screen.queryByText("Sin movimientos en este periodo")).not.toBeInTheDocument();
    expect(screen.getByTestId("total-trend-chart")).toBeInTheDocument();
  });

  it("no dice «sin movimientos» a secas cuando la regla de moneda dejó fuera movimientos del rango", () => {
    mock.accounts.mockReturnValue({
      data: [
        account,
        { id: "a2", name: "Dólares", type: "cash", currency: "USD", balance: "0.00" },
      ],
      error: undefined,
      isLoading: false,
    });
    mock.movements.mockReturnValue({
      data: [movement({ id: "m-usd", account_id: "a2", amount: "50.00" })],
      error: undefined,
      isLoading: false,
    });
    renderOpen();
    expect(screen.getByText("Sin movimientos en COP en este periodo")).toBeInTheDocument();
    expect(screen.queryByText("Sin movimientos en este periodo")).not.toBeInTheDocument();
  });

  it("nombra la moneda del usuario cuando no es COP", () => {
    mock.movements.mockReturnValue({ data: [], error: undefined, isLoading: false });
    mock.prefs.mockReturnValue({
      data: { preferences: { currency_code: "USD", locale: "es-CO" } },
      error: undefined,
      isLoading: false,
    });
    renderOpen();
    expect(screen.getByText("Sin movimientos en USD en este periodo")).toBeInTheDocument();
  });

  it("muestra el estado de carga en español", () => {
    mock.movements.mockReturnValue({ data: undefined, error: undefined, isLoading: true });
    renderOpen();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
  });

  it("muestra el error en español y reintenta las tres lecturas SWR", () => {
    mock.movements.mockReturnValue({ data: undefined, error: new Error("boom"), isLoading: false });
    renderOpen();
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar los movimientos");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(mock.mutate).toHaveBeenCalledWith("finance/movements");
    expect(mock.mutate).toHaveBeenCalledWith("dashboard/accounts");
    expect(mock.mutate).toHaveBeenCalledWith("dashboard/me");
  });

  it("al colapsar desmonta el panel pero deja el destino de aria-controls", () => {
    renderOpen();
    fireEvent.click(screen.getByRole("button", { name: "Gastos vs. ingresos" }));
    expect(screen.queryByTestId("total-trend-chart")).not.toBeInTheDocument();
    const panel = document.getElementById("dashboard-total-trend-panel");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("hidden");
  });

  it("conserva el periodo elegido al colapsar y reabrir", () => {
    renderOpen();
    fireEvent.click(screen.getByRole("radio", { name: "Día" }));
    expect(mock.chart.current?.data).toHaveLength(14);
    fireEvent.click(screen.getByRole("button", { name: "Gastos vs. ingresos" }));
    fireEvent.click(screen.getByRole("button", { name: "Gastos vs. ingresos" }));
    expect(screen.getByRole("radio", { name: "Día" })).toBeChecked();
    expect(mock.chart.current?.data).toHaveLength(14);
  });

  it("suprime la animación cuando el usuario prefiere menos movimiento", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    renderOpen();
    expect(mock.chart.current?.animate).toBe(false);
    vi.unstubAllGlobals();
  });
});
