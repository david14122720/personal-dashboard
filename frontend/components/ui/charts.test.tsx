import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EmptyState from "./EmptyState";
import FlowChart from "./FlowChart";

// S3b: CategoryDonut/BalanceChart/SavingsChart/MonthlyExpensesChart/
// MonthCompareChart were deleted with the ledger (dangling-reference fix:
// this file keeps only the surviving FlowChart + EmptyState cases).

describe("Recharts wrappers", () => {
  it("FlowChart renders an empty state without errors on empty aggregates", () => {
    render(<FlowChart data={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Sin datos de flujo aún");
  });

  it("FlowChart plots coerced income and expense series", () => {
    const { container } = render(
      <FlowChart data={[{ month: "2026-09", income: 1000, expense: 400, balance: 600 }]} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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
});
