import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BudgetBars from "./BudgetBars";
import CategoryDonut from "./CategoryDonut";
import EmptyState from "./EmptyState";
import FlowChart from "./FlowChart";

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

  it("CategoryDonut renders slices with a legend", () => {
    const { container } = render(
      <CategoryDonut data={[{ id: "c1", name: "Food", value: 35.75 }]} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Food")).toBeInTheDocument();
  });

  it("BudgetBars renders an empty state without errors on empty budgets", () => {
    render(<BudgetBars data={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("No budgets yet");
  });

  it("BudgetBars exposes each bar as screen-reader text", () => {
    const { container } = render(
      <BudgetBars data={[{ id: "b1", label: "Groceries", pct: 1.2, status: "over" }]} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Groceries: 120 percent, status over")).toBeInTheDocument();
  });

  it("EmptyState announces itself as a live status", () => {
    render(<EmptyState title="Nothing pending" hint="All clear." />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Nothing pending");
    expect(status).toHaveTextContent("All clear.");
  });
});
