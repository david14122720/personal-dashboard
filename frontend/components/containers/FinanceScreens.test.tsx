import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MovementSummaryWire, MovementWire } from "@/lib/api/finance";
import { currentPeriodRange } from "@/lib/finance/finance";
import FinanceScreens from "./FinanceScreens";

const q = (data: unknown) => ({ data, error: undefined, isLoading: false });
const err = () => ({ data: undefined, error: new Error("boom"), isLoading: false });

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const mock = vi.hoisted(() => ({
  summary: vi.fn(),
  movements: vi.fn(),
  movementsRange: vi.fn(),
}));

vi.mock("@/lib/api/dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/dashboard")>()),
  useAccounts: () =>
    q([{ id: "a1", name: "Billetera", currency: "COP", balance: "500000.00" }]),
  usePreferences: () =>
    q({ preferences: { currency_code: "COP", locale: "es-CO" } }),
}));

vi.mock("@/lib/api/finance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/finance")>()),
  useSubscriptions: () => q([]),
  useCategories: () => q([{ id: "c1", kind: "finance", name: "Comida" }]),
  useAssets: () => q([]),
  useMovements: () => mock.movements(),
  useMovementsRange: (range: unknown) => mock.movementsRange(range),
  useMovementsSummary: (query: unknown) => mock.summary(query),
}));

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

/** September ledger: outside the current cycle, so a browser-side aggregation
 * of this fixture would render the empty state. */
const SEPTEMBER_LEDGER: MovementWire[] = [
  {
    id: "m1",
    direction: "expense",
    amount: "100.00",
    occurred_on: "2026-09-10",
    description: null,
    account_id: "a1",
    category_id: "c1",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mock.movements.mockReturnValue(q(SEPTEMBER_LEDGER));
  mock.movementsRange.mockReturnValue(q([]));
  mock.summary.mockReturnValue(
    q(
      summary({
        totals: { expense: "82000.00", income: "0.00", count: 3 },
        by_category: [
          { category_id: "c1", expense: "35000.00", income: "0.00" },
          { category_id: "c2", expense: "27000.00", income: "0.00" },
          { category_id: "c3", expense: "20000.00", income: "0.00" },
        ],
        recent_total: 3,
      }),
    ),
  );
});

describe("FinanceScreens cycle KPI (S1 summary)", () => {
  it("pide el summary del ciclo mensual y muestra su gasto con los chips por categoría", () => {
    render(<FinanceScreens />);
    expect(mock.summary).toHaveBeenCalledWith({
      ...currentPeriodRange("month"),
      group: "month",
    });

    const kpis = screen.getByRole("region", { name: "Métricas de finanzas" });
    // El ledger fixture es de septiembre: la cifra solo puede venir del summary.
    expect(within(kpis).getByText("$ 82.000")).toBeInTheDocument();
    expect(within(kpis).getByText("Gastos del Período")).toBeInTheDocument();
  });

  it("usa el summary para el estado vacío cuando no hay gasto en el ciclo", () => {
    mock.summary.mockReturnValue(q(summary()));
    render(<FinanceScreens />);
    expect(screen.getByText("Sin gastos registrados este ciclo")).toBeInTheDocument();
  });

  it("muestra el footer honesto cuando el summary falla", () => {
    mock.summary.mockReturnValue(err());
    render(<FinanceScreens />);
    expect(screen.getByText("No se pudieron cargar los gastos del ciclo")).toBeInTheDocument();
  });

  it("el historial de movimientos conserva la lectura /movements sin filtrar (contrato actual)", () => {
    render(<FinanceScreens />);
    // MovementHistory sigue llamando useMovements: el summary no reemplaza el
    // contrato del ledger (S1 lo deja intacto).
    expect(mock.movements).toHaveBeenCalled();
  });
});

describe("AccountChartSection clamp (S1)", () => {
  it("renderiza el bloque de cuentas exactamente debajo del de categorías", () => {
    render(<FinanceScreens />);
    const categories = screen.getByRole("region", { name: "Gastos e ingresos por categoría" });
    const accounts = screen.getByRole("region", { name: "Gastos e ingresos por cuenta" });
    // DOM order: the account block follows the categories block, so both the
    // desktop column and the mobile `order-*` sequence keep them adjacent.
    expect(
      categories.compareDocumentPosition(accounts) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("en móvil el orden aplanado es categorías → cuentas, nunca con el ledger en medio", () => {
    render(<FinanceScreens />);
    const categories = screen.getByRole("region", { name: "Gastos e ingresos por categoría" });
    const accounts = screen.getByRole("region", { name: "Gastos e ingresos por cuenta" });
    // css (order property) is jsdom-invisible; pin the computed-order contract
    // instead: both wrappers carry `max-lg:order-2` and the account wrapper is
    // the categories wrapper's immediate next sibling, so the order-2 tie
    // resolves categories -> account (the movements ledger stays order-3).
    const catWrap = categories.closest('[class*="max-lg:order-2"]');
    const accWrap = accounts.closest('[data-finance-account-chart]');
    expect(catWrap).not.toBeNull();
    expect(accWrap).not.toBeNull();
    expect(catWrap!.getAttribute("class")).toContain("max-lg:order-2");
    expect(accWrap!.getAttribute("class")).toContain("max-lg:order-2");
    expect(catWrap!.nextElementSibling).toBe(accWrap);
  });

  it("conserva el bloque de categorías: selector, píldoras y link Comparar", () => {
    render(<FinanceScreens />);
    const categories = screen.getByRole("region", { name: "Gastos e ingresos por categoría" });
    expect(within(categories).getByLabelText("Categoría")).toBeInTheDocument();
    expect(within(categories).getByRole("radio", { name: "Mes" })).toBeChecked();
    expect(
      within(categories).getByRole("link", { name: "Comparar categorías de gasto" }),
    ).toBeInTheDocument();
    expect(within(categories).getByRole("status")).toHaveTextContent(
      "Sin movimientos en esta categoría aún",
    );
  });

  it("el selector Cuenta lista dinámicamente las cuentas del usuario (S4)", () => {
    render(<FinanceScreens />);
    const accounts = screen.getByRole("region", { name: "Gastos e ingresos por cuenta" });
    const select = within(accounts).getByLabelText("Cuenta");
    expect(within(select).getByRole("option", { name: "Billetera" })).toBeInTheDocument();
  });
});
