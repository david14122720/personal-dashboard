import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import { CategoryBars, CategoryChartSection } from "@/components/finance/CategoryCharts";
import type { MovementWire } from "@/lib/api/finance";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

function bars(expenses: number, incomes: number) {
  return render(<CategoryBars expense={expenses} income={incomes} locale="es-CO" currency="COP" />);
}

describe("CategoryBars (movement two-series)", () => {
  it("mounts gasto + ingreso series when both directions exist, never netted", () => {
    const { container } = bars(100, 50);
    const series = within(container).getAllByRole("progressbar");
    expect(series).toHaveLength(2);
    expect(series.map((s) => s.getAttribute("aria-valuenow")).sort()).toEqual(["100", "50"]);
    expect(screen.getByText("Gastos")).toBeInTheDocument();
    expect(screen.getByText("Ingresos")).toBeInTheDocument();
  });

  it("mounts a single series otherwise", () => {
    const first = bars(100, 0);
    expect(within(first.container).getAllByRole("progressbar")).toHaveLength(1);
    expect(first.container.textContent).not.toContain("Ingresos");
    first.unmount();
    const second = bars(0, 50);
    expect(within(second.container).getAllByRole("progressbar")).toHaveLength(1);
    expect(second.container.textContent).not.toContain("Gastos");
  });

  it("uses theme tokens only (no hardcoded hex)", () => {
    const { container } = bars(100, 50);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

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

describe("CategoryChartSection (movement source)", () => {
  it("lists every owned kind together with no kind split", async () => {
    renderSection();
    const select = await screen.findByLabelText("Categoría");
    expect(await within(select).findByRole("option", { name: "Comida" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Sueldo" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Ejercicio" })).toBeInTheDocument();
  });

  it("renders gasto + ingreso without netting and excludes foreign-currency rows", async () => {
    const { container } = renderSection();
    fireEvent.change(await screen.findByLabelText("Categoría"), { target: { value: "c1" } });
    const series = await within(container).findAllByRole("progressbar");
    expect(series.map((s) => s.getAttribute("aria-valuenow")).sort()).toEqual(["100", "20"]);
  });

  it("renders a single series for an expense-only category", async () => {
    const { container } = renderSection();
    fireEvent.change(await screen.findByLabelText("Categoría"), { target: { value: "c2" } });
    const series = await within(container).findAllByRole("progressbar");
    expect(series).toHaveLength(1);
    expect(series[0].getAttribute("aria-valuenow")).toBe("50");
  });
});
