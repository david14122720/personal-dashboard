import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TrendPeriodSelector from "./TrendPeriodSelector";

describe("TrendPeriodSelector", () => {
  it("renders the four period pills in order with the active one checked", () => {
    render(<TrendPeriodSelector value="month" onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "Periodo" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual([
      "day",
      "week",
      "month",
      "year",
    ]);
    expect(screen.getByRole("radio", { name: "Día" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Semana" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Mes" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Año" })).not.toBeChecked();
  });

  it("calls onChange with the clicked period", () => {
    const onChange = vi.fn();
    render(<TrendPeriodSelector value="month" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Semana" }));
    expect(onChange).toHaveBeenCalledWith("week");
    fireEvent.click(screen.getByRole("radio", { name: "Año" }));
    expect(onChange).toHaveBeenLastCalledWith("year");
  });
});
