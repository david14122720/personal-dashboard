import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ExpenseCategoryPieChart from "./ExpenseCategoryPieChart";

const data = [
  { categoryId: "c1", name: "Comida", value: 300 },
  { categoryId: "c2", name: "Transporte", value: 50 },
];

describe("ExpenseCategoryPieChart", () => {
  it("muestra el estado vacío en español cuando no hay categorías", () => {
    const { container } = render(
      <ExpenseCategoryPieChart data={[]} locale="es-CO" currency="COP" animate={false} />,
    );
    // Decisión del owner (JD-B-002): la nota vacía nombra la moneda del usuario.
    expect(screen.getByRole("status")).toHaveTextContent("Sin gastos en COP en este periodo");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("usa la moneda recibida en la nota vacía, no una fija", () => {
    render(<ExpenseCategoryPieChart data={[]} locale="es-CO" currency="USD" animate={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Sin gastos en USD en este periodo");
  });

  it("dibuja una rebanada por categoría con la leyenda en español", async () => {
    const { container } = render(
      <ExpenseCategoryPieChart data={data} locale="es-CO" currency="COP" animate={false} />,
    );
    expect(
      screen.getByRole("img", { name: "Gastos por categoría en el periodo actual" }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-sector")).toHaveLength(2);
    const items = await screen.findAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["Comida", "Transporte"]);
  });

  it("pinta cada rebanada con un token del tema, nunca un hex literal", () => {
    const { container } = render(
      <ExpenseCategoryPieChart data={data} locale="es-CO" currency="COP" animate={false} />,
    );
    const fills = [...container.querySelectorAll(".recharts-sector")].map((path) =>
      path.getAttribute("fill"),
    );
    expect(fills).toEqual(["var(--color-signal)", "var(--color-flow)"]);
    expect(fills.every((fill) => fill?.startsWith("var(--color-"))).toBe(true);
  });

  it("cicla la paleta de tokens cuando hay más categorías que colores", () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      categoryId: `c${index}`,
      name: `Categoría ${index}`,
      value: 100 - index,
    }));
    const { container } = render(
      <ExpenseCategoryPieChart data={many} locale="es-CO" currency="COP" animate={false} />,
    );
    const fills = [...container.querySelectorAll(".recharts-sector")].map((path) =>
      path.getAttribute("fill"),
    );
    expect(fills).toHaveLength(7);
    expect(fills[5]).toBe("var(--color-signal-soft)");
    expect(fills[6]).toBe("var(--color-signal)");
  });

  it("pinta la rebanada entera de inmediato cuando hay una sola categoría y la animación está activa", () => {
    const { container } = render(
      <ExpenseCategoryPieChart
        data={[{ categoryId: "c1", name: "Comida", value: 300 }]}
        locale="es-CO"
        currency="COP"
        animate
      />,
    );
    const sectors = container.querySelectorAll(".recharts-sector");
    expect(sectors).toHaveLength(1);
    expect(sectors[0].getAttribute("fill")).toMatch(/^var\(--color-/);

    const d = sectors[0].getAttribute("d") ?? "";
    expect(d).toContain("A 90,90");
    const arc = d.match(
      /M\s*([-\d.]+),([-\d.]+)\s*A\s*([-\d.]+),([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([01])\s*,\s*([01])\s*,\s*([-\d.]+),([-\d.]+)/,
    );
    expect(arc).not.toBeNull();
    const [, startX, startY, radiusX, radiusY, , largeArcFlag, , endX, endY] = arc!;
    expect(Number(radiusX)).toBe(90);
    expect(Number(radiusY)).toBe(90);
    expect(largeArcFlag).toBe("1");
    expect(Math.abs(Number(endX) - Number(startX))).toBeLessThanOrEqual(0.01);
    expect(Math.abs(Number(endY) - Number(startY))).toBeLessThanOrEqual(0.01);
  });

  it("es un pastel real, no una dona (cada rebanada llega hasta el centro)", () => {
    const { container } = render(
      <ExpenseCategoryPieChart data={data} locale="es-CO" currency="COP" animate={false} />,
    );
    const sectors = [...container.querySelectorAll(".recharts-sector")];
    expect(sectors).toHaveLength(2);
    for (const sector of sectors) {
      expect(sector.getAttribute("d")).toMatch(/L\s*180,130/);
    }
  });

  it("acepta un aria-label propio", () => {
    render(
      <ExpenseCategoryPieChart
        data={data}
        locale="es-CO"
        currency="COP"
        ariaLabel="Gastos del mes"
        animate={false}
      />,
    );
    expect(screen.getByRole("img", { name: "Gastos del mes" })).toBeInTheDocument();
  });
});
