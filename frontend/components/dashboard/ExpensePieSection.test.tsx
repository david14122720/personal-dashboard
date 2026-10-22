import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CategoryWire,
  MovementSummaryWire,
  MovementWire,
} from "@/lib/api/finance";
import { currentPeriodRange, toExpenseByCategory } from "@/lib/finance/finance";
import MovementsSnapshot from "@/components/dashboard/widgets/MovementsSnapshot";
import ExpensePieSection from "./ExpensePieSection";
import TotalTrendSection from "./TotalTrendSection";

const mock = vi.hoisted(() => ({
  movements: vi.fn(),
  movementsRange: vi.fn(),
  summary: vi.fn(),
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
  useMovementsRange: (range: unknown) => mock.movementsRange(range),
  useMovementsSummary: (query: unknown) => mock.summary(query),
  useCategories: () => mock.categories(),
}));

vi.mock("@/lib/api/dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/dashboard")>()),
  useAccounts: () => mock.accounts(),
  usePreferences: () => mock.prefs(),
}));

const NOW = new Date(2026, 9, 15, 12, 0, 0); // jueves 15 de octubre de 2026

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

function movement(overrides: Partial<MovementWire> = {}): MovementWire {
  return {
    id: "m1",
    direction: "expense",
    amount: "100.00",
    occurred_on: "2026-10-15",
    description: null,
    account_id: "a1",
    category_id: "c1",
    ...overrides,
  };
}

function category(id: string, name: string): CategoryWire {
  return {
    id,
    kind: "finance",
    name,
  };
}

const MONTH_SUMMARY = summary({
  totals: { expense: "150.00", income: "0.00", count: 2 },
  by_category: [
    { category_id: "c1", expense: "100.00", income: "0.00" },
    { category_id: "c2", expense: "50.00", income: "0.00" },
  ],
  recent: [],
  recent_total: 2,
});

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
  mock.movementsRange.mockReturnValue({ data: [], error: undefined, isLoading: false });
  // S1: el pastel lee el summary del mismo periodo que dibuja.
  mock.summary.mockReturnValue({ data: MONTH_SUMMARY, error: undefined, isLoading: false });
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
}

describe("ExpensePieSection", () => {
  it("arranca abierta con los hooks de datos y el panel montados", () => {
    render(<ExpensePieSection />);
    const trigger = screen.getByRole("button", { name: "Gastos por categoría" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "Periodo del pastel" })).toBeInTheDocument();
    expect(screen.getByTestId("dynamic-chart")).toBeInTheDocument();
    expect(mock.summary).toHaveBeenCalledTimes(1);
    expect(mock.movementsRange).not.toHaveBeenCalled();
    expect(mock.movements).not.toHaveBeenCalled();
    expect(mock.categories).toHaveBeenCalledTimes(1);
    expect(mock.prefs).toHaveBeenCalledTimes(1);
  });

  it("usa el periodo Mes por defecto al montar el panel", () => {
    renderOpen();
    expect(screen.getByRole("button", { name: "Gastos por categoría" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Mes" })).toBeChecked();
    expect(mock.summary).toHaveBeenCalledTimes(1);
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

  it("recalcula el rango del periodo actual y agrupa igual (día/semana/mes/año)", () => {
    renderOpen();
    expect(mock.summary).toHaveBeenCalledWith({
      ...currentPeriodRange("month", NOW),
      group: "month",
    });

    for (const [label, period] of [
      ["Día", "day"],
      ["Semana", "week"],
      ["Año", "year"],
    ] as const) {
      fireEvent.click(screen.getByRole("radio", { name: label }));
      expect(mock.summary).toHaveBeenCalledWith({
        ...currentPeriodRange(period, NOW),
        group: period,
      });
    }
    // El contrato de render no cambia entre periodos: el servidor decide qué
    // categorías tienen gasto en cada ventana.
    expect(mock.chart.current?.data).toHaveLength(2);
  });

  it("excluye categorías que no vienen de la API persistida", () => {
    mock.summary.mockReturnValue({
      data: summary({
        by_category: [
          { category_id: "local-only", expense: "999.00", income: "0.00" },
          { category_id: "c1", expense: "100.00", income: "0.00" },
        ],
      }),
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

  it("ignora ingresos y rebanadas en cero del summary", () => {
    mock.summary.mockReturnValue({
      data: summary({
        by_category: [
          { category_id: "c1", expense: "0.00", income: "500.00" },
          { category_id: "c2", expense: "50.00", income: "20.00" },
        ],
      }),
      error: undefined,
      isLoading: false,
    });
    renderOpen();
    expect(mock.chart.current?.data).toEqual([
      { categoryId: "c2", name: "Transporte", value: 50 },
    ]);
  });

  it("muestra el estado de carga en español", () => {
    mock.summary.mockReturnValue({ data: undefined, error: undefined, isLoading: true });
    renderOpen();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
    expect(screen.queryByTestId("dynamic-chart")).not.toBeInTheDocument();
  });

  it("muestra el error en español y reintenta sus tres lecturas SWR", () => {
    mock.categories.mockReturnValue({
      data: undefined,
      error: new Error("boom"),
      isLoading: false,
    });
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
    expect(revalidateMovements("finance/movements-summary:2026-10-01:2026-10-31:month")).toBe(true);
    expect(revalidateMovements("finance/movements")).toBe(true);
    expect(revalidateMovements("dashboard/accounts")).toBe(false);
    expect(mock.mutate).toHaveBeenCalledWith("finance/categories");
    expect(mock.mutate).toHaveBeenCalledWith("dashboard/me");
  });

  it("al colapsar desmonta el panel sin volver a montar sus hooks y deja el destino de aria-controls", () => {
    renderOpen();
    expect(mock.chart.current).not.toBeNull();
    mock.summary.mockClear();
    mock.categories.mockClear();
    mock.prefs.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Gastos por categoría" }));
    expect(screen.queryByTestId("dynamic-chart")).not.toBeInTheDocument();
    const panel = document.getElementById("dashboard-expense-pie-panel");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("hidden");
    // El panel desmontado no vuelve a leer (montaje perezoso al reabrir).
    expect(mock.summary).not.toHaveBeenCalled();
    expect(mock.categories).not.toHaveBeenCalled();
    expect(mock.prefs).not.toHaveBeenCalled();
  });

  it("conserva el periodo elegido al colapsar y reabrir", () => {
    renderOpen();
    fireEvent.click(screen.getByRole("radio", { name: "Día" }));
    fireEvent.click(screen.getByRole("button", { name: "Gastos por categoría" }));
    fireEvent.click(screen.getByRole("button", { name: "Gastos por categoría" }));
    expect(screen.getByRole("radio", { name: "Día" })).toBeChecked();
    expect(mock.summary).toHaveBeenCalledWith({
      ...currentPeriodRange("day", NOW),
      group: "day",
    });
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

  it("pide su propia ventana currentPeriodRange(period) al summary (S1)", () => {
    renderOpen();
    // Mes por defecto sobre el reloj falso (jueves 15 de octubre de 2026).
    expect(mock.summary).toHaveBeenCalledWith({
      from: "2026-10-01",
      to: "2026-10-31",
      group: "month",
    });

    fireEvent.click(screen.getByRole("radio", { name: "Día" }));
    expect(mock.summary).toHaveBeenCalledWith({
      ...currentPeriodRange("day", NOW),
      group: "day",
    });
  });

  it("MovementsSnapshot sigue en la lectura sin filtrar useMovements() (T2)", () => {
    mock.movements.mockClear();
    mock.summary.mockClear();
    render(<MovementsSnapshot />);
    expect(mock.movements).toHaveBeenCalled();
    expect(mock.summary).not.toHaveBeenCalled();
  });

  it("el render del summary coincide con la agregación cliente anterior (pin S1)", () => {
    // Fixture con todas las trampas del agregado viejo: moneda extranjera,
    // ingreso, transferencia, categoría sin persistir y fila fuera de rango.
    const ledger: MovementWire[] = [
      movement({ id: "m1", category_id: "c1", amount: "100.00", occurred_on: "2026-10-15" }),
      movement({ id: "m2", category_id: "c1", amount: "20.00", occurred_on: "2026-10-01" }),
      movement({ id: "m3", category_id: "c2", amount: "50.00", occurred_on: "2026-10-02" }),
      movement({ id: "m4", category_id: "c2", amount: "999.00", occurred_on: "2026-10-03", account_id: "a2" }),
      movement({ id: "m5", category_id: "c1", amount: "500.00", occurred_on: "2026-10-04", direction: "income" }),
      movement({ id: "m6", category_id: "c1", amount: "700.00", occurred_on: "2026-10-05", direction: "transfer" }),
      movement({ id: "m7", category_id: "local-only", amount: "111.00", occurred_on: "2026-10-06" }),
      movement({ id: "m8", category_id: "c2", amount: "222.00", occurred_on: "2026-09-30" }),
    ];
    const range = currentPeriodRange("month", NOW);
    const categories = [category("c1", "Comida"), category("c2", "Transporte")];
    const oracle = toExpenseByCategory(ledger, {
      range,
      categories,
      currencyByAccountId: new Map([
        ["a1", "COP"],
        ["a2", "USD"],
      ]),
      userCurrency: "COP",
    });
    // Equivalente servidor: mismo filtro (moneda del usuario, expense, rango)
    // y agrupación por categoría; sin transferencias, ingresos ni ids locales.
    const byCategory = new Map<string, number>();
    for (const row of ledger) {
      if (row.direction !== "expense") continue;
      if (row.account_id !== "a1") continue;
      if (row.occurred_on < range.from || row.occurred_on > range.to) continue;
      const id = row.category_id ?? "";
      byCategory.set(id, (byCategory.get(id) ?? 0) + Number(row.amount));
    }
    mock.summary.mockReturnValue({
      data: summary({
        by_category: [...byCategory.entries()].map(([categoryId, expense]) => ({
          category_id: categoryId,
          expense,
          income: "0.00",
        })),
      }),
      error: undefined,
      isLoading: false,
    });
    mock.categories.mockReturnValue({ data: categories, error: undefined, isLoading: false });

    renderOpen();

    expect(mock.chart.current?.data).toEqual(oracle);
    expect(mock.chart.current?.data).toEqual([
      { categoryId: "c1", name: "Comida", value: 120 },
      { categoryId: "c2", name: "Transporte", value: 50 },
    ]);
  });
});
