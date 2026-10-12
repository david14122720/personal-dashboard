import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EmptyState from "./EmptyState";

// S3b: CategoryDonut/BalanceChart/SavingsChart/MonthlyExpensesChart/
// MonthCompareChart were deleted with the ledger; the surviving FlowChart was
// removed with the dead-code sweep (S2/T2), so this file keeps the live
// EmptyState coverage only.

describe("Recharts wrappers", () => {
  it("EmptyState announces itself as a live status", () => {
    render(<EmptyState title="Nothing pending" hint="All clear." />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Nothing pending");
    expect(status).toHaveTextContent("All clear.");
  });
});
