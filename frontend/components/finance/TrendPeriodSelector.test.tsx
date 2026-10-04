import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TrendPeriod } from "@/lib/finance/finance";
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

  it("keeps the trend-period native radio group name by default", () => {
    render(<TrendPeriodSelector value="month" onChange={() => {}} />);
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("name"))).toEqual([
      "trend-period",
      "trend-period",
      "trend-period",
      "trend-period",
    ]);
  });

  it("keeps two selectors with distinct names in independent radio groups", () => {
    function Pair() {
      const [left, setLeft] = useState<TrendPeriod>("month");
      const [right, setRight] = useState<TrendPeriod>("month");
      return (
        <>
          <TrendPeriodSelector name="trend-left" value={left} onChange={setLeft} />
          <TrendPeriodSelector name="trend-right" value={right} onChange={setRight} />
        </>
      );
    }
    render(<Pair />);
    const [leftGroup, rightGroup] = screen.getAllByRole("group", { name: "Periodo" });
    fireEvent.click(within(leftGroup).getByRole("radio", { name: "Año" }));
    expect(within(leftGroup).getByRole("radio", { name: "Año" })).toBeChecked();
    expect(within(leftGroup).getByRole("radio", { name: "Mes" })).not.toBeChecked();
    expect(within(rightGroup).getByRole("radio", { name: "Mes" })).toBeChecked();
    expect(within(rightGroup).getByRole("radio", { name: "Año" })).not.toBeChecked();
    fireEvent.click(within(rightGroup).getByRole("radio", { name: "Día" }));
    expect(within(rightGroup).getByRole("radio", { name: "Día" })).toBeChecked();
    expect(within(leftGroup).getByRole("radio", { name: "Año" })).toBeChecked();
  });

  it("calls onChange with the clicked period", () => {
    const onChange = vi.fn();
    render(<TrendPeriodSelector value="month" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Semana" }));
    expect(onChange).toHaveBeenCalledWith("week");
    fireEvent.click(screen.getByRole("radio", { name: "Año" }));
    expect(onChange).toHaveBeenLastCalledWith("year");
  });

  it("acepta un label propio para el nombre accesible del grupo", () => {
    const { unmount } = render(
      <TrendPeriodSelector
        value="month"
        onChange={() => {}}
        label="Periodo de la tendencia"
      />,
    );
    expect(screen.getByRole("group", { name: "Periodo de la tendencia" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Periodo" })).not.toBeInTheDocument();
    unmount();
    render(<TrendPeriodSelector value="month" onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "Periodo" })).toBeInTheDocument();
  });
});
