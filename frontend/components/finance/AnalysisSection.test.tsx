import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AnalysisSection from "./AnalysisSection";

const flow = [
  { month: "2026-07", income: "2000.00", expense: "800.00" },
  { month: "2026-08", income: "2000.00", expense: "1000.00" },
  { month: "2026-09", income: "2000.00", expense: "1200.00" },
];
const byCatExpense = [{ name: "Mercado", total: "1500.00" }];
const byCatIncome = [{ name: "Salario", total: "6000.00" }];
const budgets = [{ id: "b1", label: "Mercado", spent: 90, amount: 100, pct: 0.9, status: "warn" }];

describe("AnalysisSection (PR-3 RED)", () => {
  it("renders MoM delta, >=3 direct insights and always the disclaimer", () => {
    render(
      <AnalysisSection
        flow={flow}
        byCatExpense={byCatExpense}
        byCatIncome={byCatIncome}
        budgets={budgets}
        locale="es-CO"
        currency="COP"
      />,
    );
    expect(screen.getByText("Análisis personal, no asesoramiento financiero.")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.length).toBeLessThanOrEqual(6);
    expect(screen.getByText(/Este mes gastaste/)).toBeInTheDocument();
  });
  it("omits MoM with a single month but keeps disclaimer", () => {
    render(
      <AnalysisSection
        flow={[{ month: "2026-09", income: "2000.00", expense: "800.00" }]}
        byCatExpense={byCatExpense}
        byCatIncome={byCatIncome}
        budgets={[]}
        locale="es-CO"
        currency="COP"
      />,
    );
    expect(screen.queryByText(/Este mes gastaste/)).not.toBeInTheDocument();
    expect(screen.getByText("Análisis personal, no asesoramiento financiero.")).toBeInTheDocument();
  });
  it("omits recurrent when inconclusive and shows it on frequency >=3", () => {
    const { unmount } = render(
      <AnalysisSection
        flow={flow}
        byCatExpense={byCatExpense}
        byCatIncome={byCatIncome}
        budgets={[]}
        descriptions={["a", "b", "c"]}
        locale="es-CO"
        currency="COP"
      />,
    );
    expect(screen.queryByText(/Repetiste/)).not.toBeInTheDocument();
    unmount();
    render(
      <AnalysisSection
        flow={flow}
        byCatExpense={byCatExpense}
        byCatIncome={byCatIncome}
        budgets={[]}
        descriptions={["Arriendo", "Arriendo", "Arriendo"]}
        locale="es-CO"
        currency="COP"
      />,
    );
    expect(screen.getByText(/Repetiste Arriendo/)).toBeInTheDocument();
  });
  it("shows EmptyState plus disclaimer without data", () => {
    render(
      <AnalysisSection flow={[]} byCatExpense={[]} byCatIncome={[]} budgets={[]} locale="es-CO" currency="COP" />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Sin datos para analizar");
    expect(screen.getByText("Análisis personal, no asesoramiento financiero.")).toBeInTheDocument();
  });
});
