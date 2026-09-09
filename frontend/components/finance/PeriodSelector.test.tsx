import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PeriodSelector from "./PeriodSelector";

describe("PeriodSelector (PR-3 RED)", () => {
  const now = new Date(2026, 8, 9, 12, 0, 0);
  it("defaults to month and renders 5 ranges", () => {
    const onChange = vi.fn();
    render(<PeriodSelector value={{ kind: "month" }} onChange={onChange} now={now} />);
    expect(screen.getByRole("radio", { name: "Mes" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Semana" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Trimestre" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Año" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Personalizado" })).toBeInTheDocument();
  });
  it("shows date inputs only in custom and validates from<=to inline", () => {
    const onChange = vi.fn();
    const { rerender } = render(<PeriodSelector value={{ kind: "month" }} onChange={onChange} now={now} />);
    expect(screen.queryByLabelText("Desde")).not.toBeInTheDocument();
    rerender(<PeriodSelector value={{ kind: "custom", from: "2026-09-10", to: "2026-09-01" }} onChange={onChange} now={now} />);
    expect(screen.getByLabelText("Desde")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("no es válido");
    fireEvent.click(screen.getByRole("radio", { name: "Semana" }));
    expect(onChange).toHaveBeenCalledWith({ kind: "week" });
  });
});
