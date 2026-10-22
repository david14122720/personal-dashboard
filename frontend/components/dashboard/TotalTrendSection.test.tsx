import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MovementSummaryWire } from "@/lib/api/finance";
import { chartDeckFrameClass } from "@/components/ui/chartTheme";
import { trendBuckets, trendRange } from "@/lib/finance/finance";
import TotalTrendSection from "./TotalTrendSection";

const mock = vi.hoisted(() => ({
  movements: vi.fn(),
  movementsRange: vi.fn(),
  summary: vi.fn(),
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
  useMovementsRange: (range: unknown) => mock.movementsRange(range),
  useMovementsSummary: (query: unknown) => mock.summary(query),
}));

vi.mock("@/lib/api/dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/dashboard")>()),
  useAccounts: () => mock.accounts(),
  usePreferences: () => mock.prefs(),
}));

const account = { id: "a1", name: "Billetera", type: "cash", currency: "COP", balance: "0.00" };

const EMPTY_SUMMARY: MovementSummaryWire = {
  totals: { expense: "0.00", income: "0.00", count: 0 },
  by_account: [],
  by_category: [],
  buckets: [],
  recent: [],
  recent_total: 0,
};

function summary(partial: Partial<MovementSummaryWire> = {}): MovementSummaryWire {
  return { ...EMPTY_SUMMARY, ...partial };
}

/** One non-empty bucket in the last window of `group`, mirroring the server
 * keys (`YYYY-MM-DD` | `YYYY-Www` | `YYYY-MM` | `YYYY`). */
function lastBucket(group: "day" | "week" | "month" | "year", expense: string, income = "0.00") {
  const last = trendBuckets(group).at(-1)!;
  return { key: last.key, from: last.from, to: last.to, expense, income };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.chart.current = null;
  mock.movements.mockReturnValue({ data: [], error: undefined, isLoading: false });
  mock.movementsRange.mockReturnValue({ data: [], error: undefined, isLoading: false });
  // S1: el panel lee el summary (agregado en servidor); la ventana la elige la
  // propia vista y el mock devuelve un bucket no vacío en su último periodo.
  mock.summary.mockImplementation((query: { group: "day" | "week" | "month" | "year" }) => ({
    data: summary({
      totals: { expense: "100.00", income: "0.00", count: 1 },
      buckets: [lastBucket(query.group, "100.00")],
      recent_total: 1,
    }),
    error: undefined,
    isLoading: false,
  }));
  mock.accounts.mockReturnValue({ data: [account], error: undefined, isLoading: false });
  mock.prefs.mockReturnValue({
    data: { preferences: { currency_code: "COP", locale: "es-CO" } },
    error: undefined,
    isLoading: false,
  });
});

function renderOpen() {
  render(<TotalTrendSection />);
}

describe("TotalTrendSection", () => {
  it("arranca abierta con los hooks de datos y el panel montados", () => {
    render(<TotalTrendSection />);
    const trigger = screen.getByRole("button", { name: "Gastos vs. ingresos" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "Periodo de la tendencia" })).toBeInTheDocument();
    expect(screen.getByTestId("total-trend-chart")).toBeInTheDocument();
    expect(mock.summary).toHaveBeenCalledTimes(1);
    expect(mock.movementsRange).not.toHaveBeenCalled();
    expect(mock.movements).not.toHaveBeenCalled();
    expect(mock.prefs).toHaveBeenCalledTimes(1);
  });

  it("usa el periodo Mes por defecto al montar el panel", () => {
    renderOpen();
    expect(screen.getByRole("button", { name: "Gastos vs. ingresos" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Mes" })).toBeChecked();
    expect(mock.summary).toHaveBeenCalledTimes(1);
    expect(mock.movements).not.toHaveBeenCalled();
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
    mock.summary.mockReturnValue({ data: summary(), error: undefined, isLoading: false });
    renderOpen();
    expect(screen.getByText("Sin movimientos en COP en este periodo")).toBeInTheDocument();
    expect(screen.queryByText("Sin movimientos en este periodo")).not.toBeInTheDocument();
    expect(screen.getByTestId("total-trend-chart")).toBeInTheDocument();
  });

  it("nombra la moneda del usuario cuando no es COP", () => {
    mock.summary.mockReturnValue({ data: summary(), error: undefined, isLoading: false });
    mock.prefs.mockReturnValue({
      data: { preferences: { currency_code: "USD", locale: "es-CO" } },
      error: undefined,
      isLoading: false,
    });
    renderOpen();
    expect(screen.getByText("Sin movimientos en USD en este periodo")).toBeInTheDocument();
  });

  it("muestra el estado de carga en español", () => {
    mock.summary.mockReturnValue({ data: undefined, error: undefined, isLoading: true });
    renderOpen();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
  });

  it("muestra el error en español y reintenta las lecturas SWR", () => {
    mock.summary.mockReturnValue({ data: undefined, error: new Error("boom"), isLoading: false });
    renderOpen();
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar los movimientos");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    // El reintento revalida la clave del summary por prefijo (SWR 2.5.1).
    expect(mock.mutate).toHaveBeenCalledWith(expect.any(Function));
    const predicates = mock.mutate.mock.calls
      .map(([arg]) => arg)
      .filter((arg): arg is (key: unknown) => boolean => typeof arg === "function");
    expect(predicates).toHaveLength(1);
    const revalidateMovements = predicates[0];
    expect(revalidateMovements("finance/movements-summary:2026-01-01:2026-12-31:month")).toBe(true);
    expect(revalidateMovements("finance/movements")).toBe(true);
    expect(revalidateMovements("dashboard/accounts")).toBe(false);
    expect(mock.mutate).toHaveBeenCalledWith("dashboard/me");
  });

  it("al colapsar desmonta el panel sin volver a montar sus hooks y deja el destino de aria-controls", () => {
    renderOpen();
    expect(mock.chart.current).not.toBeNull();
    mock.summary.mockClear();
    mock.prefs.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Gastos vs. ingresos" }));
    expect(screen.queryByTestId("total-trend-chart")).not.toBeInTheDocument();
    const panel = document.getElementById("dashboard-total-trend-panel");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("hidden");
    // El panel desmontado no vuelve a leer (montaje perezoso al reabrir).
    expect(mock.summary).not.toHaveBeenCalled();
    expect(mock.prefs).not.toHaveBeenCalled();
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

  it("aplica el marco D8 de chartTheme al contenedor del gráfico", () => {
    renderOpen();
    expect(screen.getByTestId("trend-chart-frame").className).toBe(chartDeckFrameClass);
  });

  it("muestra la leyenda con los totales reales del periodo, nunca las cifras del prototipo", () => {
    renderOpen();
    expect(screen.getByText(/^Gastos:/)).toHaveTextContent("Gastos: $ 100");
    expect(screen.getByText(/^Ingresos:/)).toHaveTextContent("Ingresos: $ 0");
    expect(screen.queryByText(/34\.100/)).not.toBeInTheDocument();
  });

  it("suprime la animación cuando el usuario prefiere menos movimiento", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    renderOpen();
    expect(mock.chart.current?.animate).toBe(false);
    vi.unstubAllGlobals();
  });

  it("pide su propia ventana trendRange(period) con el group del periodo (S1)", () => {
    renderOpen();
    // Mes por defecto: la ventana exacta de los 12 buckets que dibuja.
    expect(mock.summary).toHaveBeenCalledWith({ ...trendRange("month"), group: "month" });

    fireEvent.click(screen.getByRole("radio", { name: "Día" }));
    expect(mock.summary).toHaveBeenCalledWith({ ...trendRange("day"), group: "day" });

    fireEvent.click(screen.getByRole("radio", { name: "Semana" }));
    expect(mock.summary).toHaveBeenCalledWith({ ...trendRange("week"), group: "week" });

    fireEvent.click(screen.getByRole("radio", { name: "Año" }));
    expect(mock.summary).toHaveBeenCalledWith({ ...trendRange("year"), group: "year" });
  });

  it("mapea los buckets del servidor por key y rellena con 0/0 los que faltan (S1)", () => {
    const windows = trendBuckets("month");
    const first = windows[0];
    const last = windows[windows.length - 1];
    mock.summary.mockReturnValue({
      data: summary({
        totals: { expense: "100.00", income: "40.00", count: 2 },
        buckets: [
          { key: first.key, from: first.from, to: first.to, expense: "30.00", income: "10.00" },
          { key: last.key, from: last.from, to: last.to, expense: "70.00", income: "30.00" },
        ],
      }),
      error: undefined,
      isLoading: false,
    });
    renderOpen();
    const rows = mock.chart.current?.data as { bucket: string; expense: number; income: number }[];
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ bucket: first.key, expense: 30, income: 10 });
    expect(rows[rows.length - 1]).toMatchObject({ bucket: last.key, expense: 70, income: 30 });
    // Las ventanas que el servidor omitió quedan en cero, nunca se descartan.
    expect(rows[1]).toMatchObject({ bucket: windows[1].key, expense: 0, income: 0 });
    expect(screen.getByText(/^Gastos:/)).toHaveTextContent("Gastos: $ 100");
    expect(screen.getByText(/^Ingresos:/)).toHaveTextContent("Ingresos: $ 40");
  });
});
