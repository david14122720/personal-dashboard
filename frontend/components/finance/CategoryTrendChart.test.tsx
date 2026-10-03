import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CategoryTrendChart, { type TrendRow, type TrendSeries } from "./CategoryTrendChart";

const series: TrendSeries[] = [
  { key: "expense", label: "Gastos", token: "--color-signal" },
  { key: "income", label: "Ingresos", token: "--color-flow", dashed: true },
];

const data: TrendRow[] = [
  { bucket: "2026-09", label: "sep 26", expense: 25000, income: 0 },
  { bucket: "2026-10", label: "oct 26", expense: 1200000, income: 40000 },
];

describe("CategoryTrendChart", () => {
  it("renders the accessible chart with one legend entry per series", () => {
    const { container } = render(
      <CategoryTrendChart data={data} series={series} locale="es-CO" currency="COP" animate={false} />,
    );
    expect(screen.getByRole("img", { name: "Tendencia de gastos e ingresos" })).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Gastos")).toBeInTheDocument();
    expect(screen.getByText("Ingresos")).toBeInTheDocument();
  });

  it("accepts a custom accessible name", () => {
    render(
      <CategoryTrendChart
        data={data}
        series={series}
        locale="es-CO"
        currency="COP"
        ariaLabel="Comparar categorías"
        animate={false}
      />,
    );
    expect(screen.getByRole("img", { name: "Comparar categorías" })).toBeInTheDocument();
  });

  it("falls back to the empty state without data or without series", () => {
    const first = render(
      <CategoryTrendChart data={[]} series={series} locale="es-CO" currency="COP" animate={false} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Sin movimientos en esta categoría aún");
    first.unmount();
    const { container } = render(
      <CategoryTrendChart data={data} series={[]} locale="es-CO" currency="COP" animate={false} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Sin movimientos en esta categoría aún");
    expect(container.querySelector("svg")).toBeNull();
  });
});
