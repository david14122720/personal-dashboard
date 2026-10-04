import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DashboardDisclosure from "./DashboardDisclosure";

const base = {
  title: "Gastos vs. ingresos",
  hint: "Totales por periodo, sin agrupar por categoría.",
  panelId: "dashboard-total-trend-panel",
};

function renderDisclosure(open: boolean, onToggle = () => {}) {
  return render(
    <DashboardDisclosure {...base} open={open} onToggle={onToggle}>
      <p>Contenido</p>
    </DashboardDisclosure>,
  );
}

describe("DashboardDisclosure", () => {
  it("expone h2 > button con aria-expanded/aria-controls y el destino existe oculto", () => {
    const { container } = renderDisclosure(false);
    expect(
      screen.getByRole("heading", { level: 2, name: "Gastos vs. ingresos" }),
    ).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Gastos vs. ingresos" });
    expect(trigger).toHaveAttribute("type", "button");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls", base.panelId);
    const panel = container.querySelector(`#${base.panelId}`);
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("hidden");
    expect(screen.queryByText("Contenido")).not.toBeInTheDocument();
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it("al abrir, el panel deja de estar hidden y monta children", () => {
    const { container, rerender } = renderDisclosure(false);
    rerender(
      <DashboardDisclosure {...base} open={true} onToggle={() => {}}>
        <p>Contenido</p>
      </DashboardDisclosure>,
    );
    expect(screen.getByRole("button", { name: "Gastos vs. ingresos" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const panel = container.querySelector(`#${base.panelId}`);
    expect(panel).not.toHaveAttribute("hidden");
    expect(screen.getByText("Contenido")).toBeInTheDocument();
  });

  it("vuelve a ocultar children sin sacar el destino del DOM", () => {
    const { container, rerender } = renderDisclosure(true);
    expect(screen.getByText("Contenido")).toBeInTheDocument();
    rerender(
      <DashboardDisclosure {...base} open={false} onToggle={() => {}}>
        <p>Contenido</p>
      </DashboardDisclosure>,
    );
    expect(screen.queryByText("Contenido")).not.toBeInTheDocument();
    const panel = container.querySelector(`#${base.panelId}`);
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("hidden");
  });

  it("llama onToggle al activar el control nativo (operable con teclado)", () => {
    const onToggle = vi.fn();
    renderDisclosure(false, onToggle);
    fireEvent.click(screen.getByRole("button", { name: "Gastos vs. ingresos" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("mantiene foco visible y un área de toque de al menos 44×44", () => {
    renderDisclosure(false);
    const trigger = screen.getByRole("button", { name: "Gastos vs. ingresos" });
    expect(trigger.className).toContain("min-h-[44px]");
    expect(trigger.className).toContain("min-w-[44px]");
    expect(trigger.className).toContain("focus-visible:ring-2");
    expect(trigger.className).toContain("focus-visible:ring-signal");
  });
});
