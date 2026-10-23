import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import { AccountChartSection } from "@/components/finance/AccountCharts";
import { trendBuckets, trendRange } from "@/lib/finance/finance";
import type { MovementWire } from "@/lib/api/finance";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

/** Last month bucket: every fixture stays inside the default Mes window. */
const currentMonth = trendBuckets("month").at(-1)!;

function movement(id: string, overrides: Partial<MovementWire> = {}): MovementWire {
  return {
    id,
    direction: "expense",
    amount: "100.00",
    occurred_on: currentMonth.from,
    description: null,
    account_id: "a1",
    category_id: "c1",
    ...overrides,
  };
}

const movements: MovementWire[] = [
  movement("m1", { account_id: "a1", direction: "expense", amount: "120000.00" }),
  movement("m2", { account_id: "a1", direction: "income", amount: "45000.00" }),
  movement("m3", { account_id: "a2", direction: "expense", amount: "7000.00" }),
  // A transfer is neither expense nor income, even when it touches the account.
  movement("m4", {
    account_id: "a1",
    direction: "transfer",
    amount: "500000.00",
    transfer_account_id: "a2",
  }),
];

const movementUrls: string[] = [];

const server = setupServer(
  http.get("http://test.local/api/movements", ({ request }) => {
    movementUrls.push(request.url);
    return HttpResponse.json(movements);
  }),
  http.get("http://test.local/api/accounts", () =>
    HttpResponse.json([
      { id: "a1", name: "Principal", type: "bank", currency: "COP", balance: "100000.00" },
      { id: "a2", name: "Ahorros", type: "bank", currency: "COP", balance: "50000.00" },
      { id: "usd1", name: "Bolsillo USD", type: "bank", currency: "USD", balance: "10.00" },
    ]),
  ),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  movementUrls.length = 0;
});
afterAll(() => server.close());

function renderSection() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AccountChartSection locale="es-CO" currency="COP" />
    </SWRConfig>,
  );
}

/** Axis labels of `period` buckets that are currently rendered as text. */
function renderedPeriodLabels(container: HTMLElement, period: "day" | "month") {
  const text = container.textContent ?? "";
  return trendBuckets(period).filter((window) => text.includes(window.label));
}

describe("AccountChartSection (movement source)", () => {
  it("renders the owner title/subtitle and lists every account as an option", async () => {
    renderSection();
    const section = screen.getByRole("region", { name: "Gastos e ingresos por cuenta" });
    expect(
      within(section).getByText("Elige una cuenta para ver sus gastos y sus ingresos."),
    ).toBeInTheDocument();
    const select = await within(section).findByLabelText("Cuenta");
    expect(within(select).getByRole("option", { name: "Principal" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Ahorros" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Bolsillo USD" })).toBeInTheDocument();
    // A3: the categories block's compare footer is not replicated.
    expect(
      within(section).queryByRole("link", { name: "Comparar categorías de gasto" }),
    ).not.toBeInTheDocument();
  });

  it("renders the four period pills with Mes active by default", async () => {
    renderSection();
    await screen.findByLabelText("Cuenta");
    expect(screen.getByRole("group", { name: "Periodo" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual([
      "day",
      "week",
      "month",
      "year",
    ]);
    expect(screen.getByRole("radio", { name: "Mes" })).toBeChecked();
  });

  it("keeps the empty state and hides the chart until an account is selected", async () => {
    renderSection();
    await screen.findByLabelText("Cuenta");
    expect(screen.getByRole("status")).toHaveTextContent("Sin movimientos en esta cuenta aún");
    expect(
      screen.queryByRole("img", { name: "Tendencia de gastos e ingresos" }),
    ).not.toBeInTheDocument();
  });

  it("no pide el ledger hasta que hay una cuenta elegida (A2)", async () => {
    renderSection();
    await screen.findByLabelText("Cuenta");
    // Sin cuenta no hay serie que dibujar: pedir la ventana completa sería
    // bajar el ledger entero para no mostrar nada.
    expect(movementUrls).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Cuenta"), { target: { value: "a1" } });
    await screen.findByRole("img", { name: "Tendencia de gastos e ingresos" }, { timeout: 5000 });
    expect(movementUrls.length).toBeGreaterThan(0);
  });

  it("pide su propia ventana trendRange(period) y muestra gráfica + contadores", async () => {
    renderSection();
    fireEvent.change(await screen.findByLabelText("Cuenta"), { target: { value: "a1" } });
    expect(
      await screen.findByRole("img", { name: "Tendencia de gastos e ingresos" }, { timeout: 5000 }),
    ).toBeInTheDocument();

    const expected = trendRange("month");
    const urls = movementUrls.map((u) => new URL(u));
    expect(urls.map((u) => u.searchParams.get("from"))).toContain(expected.from);
    expect(urls.map((u) => u.searchParams.get("to"))).toContain(expected.to);

    expect(screen.getByText("Gastos")).toBeInTheDocument();
    expect(screen.getByText("Ingresos")).toBeInTheDocument();
    // Only a1's expense/income: a2 and the transfer never land in the totals.
    expect(screen.getByText("$ 120.000")).toBeInTheDocument();
    expect(screen.getByText("$ 45.000")).toBeInTheDocument();
  });

  it("re-fetches and re-buckets when the period changes", async () => {
    const { container } = renderSection();
    fireEvent.change(await screen.findByLabelText("Cuenta"), { target: { value: "a1" } });
    await screen.findByRole("img", { name: "Tendencia de gastos e ingresos" }, { timeout: 5000 });
    expect(renderedPeriodLabels(container, "month")).toHaveLength(12);
    expect(renderedPeriodLabels(container, "day")).toHaveLength(0);
    const monthRequests = movementUrls.length;

    fireEvent.click(screen.getByRole("radio", { name: "Día" }));

    await waitFor(() => expect(renderedPeriodLabels(container, "day")).toHaveLength(14));
    expect(renderedPeriodLabels(container, "month")).toHaveLength(0);
    expect(movementUrls.length).toBeGreaterThan(monthRequests);
    const expected = trendRange("day");
    const dayUrl = movementUrls
      .map((u) => new URL(u))
      .find((u) => u.searchParams.get("from") === expected.from);
    expect(dayUrl?.searchParams.get("to")).toBe(expected.to);
  });

  it("reacts to the selected account, swapping the totals", async () => {
    renderSection();
    const select = await screen.findByLabelText("Cuenta");
    fireEvent.change(select, { target: { value: "a1" } });
    expect(await screen.findByText("$ 120.000")).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "a2" } });
    expect(await screen.findByText("$ 7.000")).toBeInTheDocument();
    expect(screen.queryByText("$ 120.000")).not.toBeInTheDocument();
    expect(screen.queryByText("$ 45.000")).not.toBeInTheDocument();
  });
});
