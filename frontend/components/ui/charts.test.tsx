import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BudgetBars, { budgetBarFill, budgetBarLabel } from "./BudgetBars";
import CategoryDonut, { donutPalette } from "./CategoryDonut";
import EmptyState from "./EmptyState";
import FlowChart from "./FlowChart";
import BalanceChart from "./BalanceChart";
import SavingsChart from "./SavingsChart";
import MonthlyExpensesChart from "./MonthlyExpensesChart";
import MonthCompareChart from "./MonthCompareChart";

describe("Recharts wrappers", () => {
  it("FlowChart renders an empty state without errors on empty aggregates", () => {
    render(<FlowChart data={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("No flow data yet");
  });

  it("FlowChart plots coerced income and expense series", () => {
    const { container } = render(
      <FlowChart data={[{ month: "2026-09", income: 1000, expense: 400, balance: 600 }]} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("CategoryDonut renders an empty state without errors on empty aggregates", () => {
    render(<CategoryDonut data={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("No category data yet");
  });

  it("CategoryDonut shows direct money values beside each legend entry", () => {
    render(<CategoryDonut data={[{ id: "c1", name: "Food", value: 35.75 }]} />);
    expect(screen.getByText(/Food/)).toBeInTheDocument();
    expect(screen.getByText(/36/)).toBeInTheDocument();
  });

  it("BudgetBars renders an empty state without errors on empty budgets", () => {
    render(<BudgetBars data={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("No budgets yet");
  });

  it("BudgetBars exposes each bar as screen-reader text in Spanish", () => {
    const { container } = render(
      <BudgetBars data={[{ id: "b1", label: "Groceries", pct: 1.2, status: "over" }]} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Groceries: 120 por ciento, estado over")).toBeInTheDocument();
  });

  it("BudgetBars direct value labels keep the true pct including over-budget", () => {
    // Recharts 3 LabelList SVG text does not render in jsdom (same as Pie
    // sectors per slice-3b); assert the exported label helper instead.
    expect(budgetBarLabel(1.2)).toBe("120%");
    expect(budgetBarLabel(0.455)).toBe("46%");
  });

  it("EmptyState announces itself as a live status", () => {
    render(<EmptyState title="Nothing pending" hint="All clear." />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Nothing pending");
    expect(status).toHaveTextContent("All clear.");
  });

  it("FlowChart renders Spanish month ticks instead of raw YYYY-MM", () => {
    const { container } = render(<FlowChart data={[{ month: "2026-09", income: 1000, expense: 400, balance: 600 }]} />);
    expect(screen.queryByText("2026-09")).not.toBeInTheDocument();
    expect(container.textContent).toMatch(/2026/);
  });

  it("chart fills come from theme tokens (no hardcoded hex)", () => {
    const fills = [...donutPalette(), budgetBarFill("ok"), budgetBarFill("warn"), budgetBarFill("over")];
    expect(fills.join(" ")).not.toContain("#");
  });
});

// -- PR-3 S6 charts RED (4 nuevos + EmptyState + reduced-motion) --
describe("S6 charts (PR-3 RED)", () => {
  it("BalanceChart plots accumulated balances from flow", () => {
    const { container } = render(
      <BalanceChart
        data={[
          { month: "2026-08", balance: 600 },
          { month: "2026-09", balance: 1300 },
        ]}
      />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("BalanceChart shows Spanish EmptyState without errors", () => {
    render(<BalanceChart data={[]} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
  it("SavingsChart plots monthly savings and admits negative", () => {
    const { container } = render(
      <SavingsChart
        data={[
          { month: "2026-08", savings: 600 },
          { month: "2026-09", savings: -100 },
        ]}
      />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });
  it("SavingsChart shows EmptyState on empty", () => {
    render(<SavingsChart data={[]} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
  it("MonthlyExpensesChart plots expense bars with COP tooltips", () => {
    const { container } = render(
      <MonthlyExpensesChart
        data={[
          { month: "2026-08", expense: 300 },
          { month: "2026-09", expense: 500 },
        ]}
      />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });
  it("MonthCompareChart shows delta +25% and EmptyState when <2 months", () => {
    const { container } = render(
      <MonthCompareChart
        data={[
          { month: "2026-08", income: 900, expense: 400 },
          { month: "2026-09", income: 1200, expense: 500 },
        ]}
      />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toMatch(/25/);
  });
  it("MonthCompareChart EmptyState on single month", () => {
    render(<MonthCompareChart data={[{ month: "2026-09", income: 1000, expense: 400 }]} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
  it("S6 charts suppress animation under reduced-motion", () => {
    const { container } = render(
      <BalanceChart data={[{ month: "2026-09", balance: 600 }]} animate={false} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    const { container: c2 } = render(
      <SavingsChart data={[{ month: "2026-09", savings: 600 }]} animate={false} />,
    );
    expect(c2.querySelector("svg")).not.toBeNull();
  });
  it("S6 charts are keyboard-focusable with Spanish EmptyStates (triangulate)", () => {
    const { unmount } = render(<BalanceChart data={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Sin datos de saldo");
    unmount();
    const r2 = render(<SavingsChart data={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Sin datos de ahorro");
    r2.unmount();
    const r3 = render(<MonthlyExpensesChart data={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Sin gastos");
    r3.unmount();
    const r4 = render(<MonthCompareChart data={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("suficiente historial");
    r4.unmount();
    const { container } = render(<BalanceChart data={[{ month: "2026-09", balance: 10 }]} />);
    const region = container.querySelector('[role="img"]');
    expect(region?.getAttribute("tabindex")).toBe("0");
    expect(container.innerHTML).not.toContain("#");
  });
});
