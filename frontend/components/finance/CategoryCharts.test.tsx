import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import { CategoryChartSection } from "@/components/finance/CategoryCharts";
import { trendBuckets } from "@/lib/finance/finance";
import type { MovementWire } from "@/lib/api/finance";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

function movement(id: string, overrides: Partial<MovementWire> = {}): MovementWire {
  return {
    id,
    direction: "expense",
    amount: "100.00",
    occurred_on: "2026-09-24",
    description: null,
    account_id: "a1",
    category_id: "c1",
    subscription_id: null,
    created_at: "2026-09-24T10:00:00Z",
    updated_at: "2026-09-24T10:00:00Z",
    ...overrides,
  };
}

const movements: MovementWire[] = [
  movement("m1", { category_id: "c1", amount: "100.00", direction: "expense", account_id: "a1" }),
  movement("m2", { category_id: "c1", amount: "20.00", direction: "income", account_id: "a1" }),
  movement("m3", { category_id: "c1", amount: "999.00", direction: "expense", account_id: "a2" }),
  movement("m4", { category_id: "c2", amount: "50.00", direction: "expense", account_id: "a1" }),
];

const server = setupServer(
  http.get("http://test.local/api/movements", () => HttpResponse.json(movements)),
  http.get("http://test.local/api/accounts", () =>
    HttpResponse.json([
      { id: "a1", name: "Principal", type: "bank", currency: "COP", balance: "100000.00" },
      { id: "a2", name: "Bolsillo USD", type: "bank", currency: "USD", balance: "10.00" },
    ]),
  ),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const categories = [
  { id: "c1", name: "Comida", kind: "finance" },
  { id: "c2", name: "Sueldo", kind: "subscription" },
  { id: "c3", name: "Ejercicio", kind: "habit" },
];

function renderSection() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CategoryChartSection categories={categories} locale="es-CO" currency="COP" />
    </SWRConfig>,
  );
}

/** Axis labels of `period` buckets that are currently rendered as text. */
function renderedPeriodLabels(container: HTMLElement, period: "day" | "month") {
  const text = container.textContent ?? "";
  return trendBuckets(period).filter((window) => text.includes(window.label));
}

describe("CategoryChartSection (movement source)", () => {
  it("lists every owned kind together with no kind split", async () => {
    renderSection();
    const select = await screen.findByLabelText("Categoría");
    expect(await within(select).findByRole("option", { name: "Comida" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Sueldo" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Ejercicio" })).toBeInTheDocument();
  });

  it("renders the four period pills with Mes active by default", async () => {
    renderSection();
    await screen.findByLabelText("Categoría");
    expect(screen.getByRole("group", { name: "Periodo" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual([
      "day",
      "week",
      "month",
      "year",
    ]);
    expect(screen.getByRole("radio", { name: "Mes" })).toBeChecked();
  });

  it("keeps the empty state and hides the chart until a category is selected", async () => {
    renderSection();
    await screen.findByLabelText("Categoría");
    expect(screen.getByRole("status")).toHaveTextContent("Sin movimientos en esta categoría aún");
    expect(
      screen.queryByRole("img", { name: "Tendencia de gastos e ingresos" }),
    ).not.toBeInTheDocument();
  });

  it("renders the gasto/ingreso trend for the selected category", async () => {
    renderSection();
    fireEvent.change(await screen.findByLabelText("Categoría"), { target: { value: "c1" } });
    expect(
      await screen.findByRole("img", { name: "Tendencia de gastos e ingresos" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Gastos")).toBeInTheDocument();
    expect(screen.getByText("Ingresos")).toBeInTheDocument();
  });

  it("switches the rendered bucket count and labels between Mes and Día", async () => {
    const { container } = renderSection();
    fireEvent.change(await screen.findByLabelText("Categoría"), { target: { value: "c1" } });
    await screen.findByRole("img", { name: "Tendencia de gastos e ingresos" });

    expect(renderedPeriodLabels(container, "month")).toHaveLength(12);
    expect(renderedPeriodLabels(container, "day")).toHaveLength(0);

    fireEvent.click(screen.getByRole("radio", { name: "Día" }));

    expect(renderedPeriodLabels(container, "day")).toHaveLength(14);
    expect(renderedPeriodLabels(container, "month")).toHaveLength(0);
  });

  it("draws the flat trend plus the no-data note for a category with no movements in range", async () => {
    renderSection();
    fireEvent.change(await screen.findByLabelText("Categoría"), { target: { value: "c3" } });
    expect(
      await screen.findByRole("img", { name: "Tendencia de gastos e ingresos" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sin movimientos en este periodo")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
