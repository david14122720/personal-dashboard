import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import { MovementHistory } from "@/components/finance/MovementHistory";
import type { MovementWire } from "@/lib/api/finance";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const accounts = [
  { id: "a1", name: "Cuenta principal" },
  { id: "a2", name: "Bolsillo" },
];
const categories = [
  { id: "c1", name: "Mercado" },
  { id: "c2", name: "Sueldo" },
];

function wire(id: string, overrides: Partial<MovementWire> = {}): MovementWire {
  return {
    id,
    direction: "expense",
    amount: "100.00",
    occurred_on: "2026-09-24",
    description: `desc-${id}`,
    account_id: "a1",
    category_id: "c1",
    subscription_id: null,
    created_at: "2026-09-24T10:00:00Z",
    updated_at: "2026-09-24T10:00:00Z",
    ...overrides,
  };
}

/** Movement `m{n}` with `occurred_on` descending from 2026-09-30: API order. */
function dated(n: number, overrides: Partial<MovementWire> = {}): MovementWire {
  const date = new Date(Date.UTC(2026, 8, 30));
  date.setUTCDate(date.getUTCDate() - n);
  return wire(`m${n}`, { occurred_on: date.toISOString().slice(0, 10), ...overrides });
}

let movements: MovementWire[] = [];
let movementsGets = 0;

const server = setupServer(
  http.get("http://test.local/api/movements", () => {
    movementsGets += 1;
    return HttpResponse.json(movements);
  }),
  http.delete("http://test.local/api/movements/:id", () => {
    return new HttpResponse(null, { status: 204 });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  movements = [];
  movementsGets = 0;
});
afterAll(() => server.close());

const baseProps = {
  accounts,
  categories,
  locale: "es-CO",
  currency: "COP",
  activeAccountId: null as string | null,
  onSelectAccount: () => undefined,
  onEdit: () => undefined,
};

function renderHistory(props: Partial<typeof baseProps> = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MovementHistory {...baseProps} {...props} />
    </SWRConfig>,
  );
}

/** Simulates `FinanceScreens`, which owns `activeAccountId`. */
function renderHistoryWithAccountFilter() {
  function Host() {
    const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
    return (
      <MovementHistory
        {...baseProps}
        activeAccountId={activeAccountId}
        onSelectAccount={setActiveAccountId}
      />
    );
  }
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Host />
    </SWRConfig>,
  );
}

describe("MovementHistory", () => {
  it("renders the first five rows in API order with a Ver más control", async () => {
    movements = Array.from({ length: 34 }, (_, n) => dated(n));
    const { container } = renderHistory();
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(5));
    const items = container.querySelectorAll("li");
    expect(items[0].textContent).toContain("desc-m0");
    expect(items[1].textContent).toContain("desc-m1");
    expect(items[4].textContent).toContain("desc-m4");
    expect(container.textContent).not.toContain("desc-m5");
    expect(screen.getByRole("button", { name: "Ver más" })).toBeInTheDocument();
  });

  it("appends ten rows per activation, accumulatively, without replacing them", async () => {
    movements = Array.from({ length: 44 }, (_, n) => dated(n));
    const { container } = renderHistory();
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(5));

    fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(15));
    let items = container.querySelectorAll("li");
    expect(items[0].textContent).toContain("desc-m0");
    expect(items[4].textContent).toContain("desc-m4");
    expect(items[14].textContent).toContain("desc-m14");
    expect(container.textContent).not.toContain("desc-m15");

    fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(25));

    fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(35));
    items = container.querySelectorAll("li");
    expect(items[0].textContent).toContain("desc-m0");
    expect(items[34].textContent).toContain("desc-m34");
  });

  it("shows every row and hides Ver más once the list is exhausted", async () => {
    movements = Array.from({ length: 23 }, (_, n) => dated(n));
    const { container } = renderHistory();
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(5));

    fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(15));

    fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(23));
    expect(container.querySelectorAll("li")[22].textContent).toContain("desc-m22");
    expect(screen.queryByRole("button", { name: "Ver más" })).not.toBeInTheDocument();
  });

  it("renders three rows and no Ver más control with three movements", async () => {
    movements = Array.from({ length: 3 }, (_, n) => dated(n));
    const { container } = renderHistory();
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(3));
    expect(screen.queryByRole("button", { name: "Ver más" })).not.toBeInTheDocument();
  });

  it("resets to five rows when the direction filter changes without changing the filter", async () => {
    movements = Array.from({ length: 30 }, (_, n) =>
      dated(n, { direction: n % 2 === 0 ? "expense" : "income" }),
    );
    const { container } = renderHistory();
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(5));
    fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
    fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(25));

    const directionSelect = screen.getByLabelText("Tipo") as HTMLSelectElement;
    fireEvent.change(directionSelect, { target: { value: "income" } });
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(5));
    expect(directionSelect.value).toBe("income");
    let items = container.querySelectorAll("li");
    expect(items[0].textContent).toContain("desc-m1");
    expect(items[4].textContent).toContain("desc-m9");
    expect(container.textContent).not.toContain("desc-m0");

    // Returning to "Todas" must not restore the previously expanded window.
    fireEvent.change(directionSelect, { target: { value: "" } });
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(5));
    expect(directionSelect.value).toBe("");
    items = container.querySelectorAll("li");
    expect(items[0].textContent).toContain("desc-m0");
  });

  it("resets to five rows when the category filter changes without changing the filter", async () => {
    movements = Array.from({ length: 30 }, (_, n) =>
      dated(n, { category_id: n % 2 === 0 ? "c1" : "c2" }),
    );
    const { container } = renderHistory();
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(5));
    fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
    fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(25));

    const categorySelect = screen.getByLabelText("Categoría") as HTMLSelectElement;
    fireEvent.change(categorySelect, { target: { value: "c2" } });
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(5));
    expect(categorySelect.value).toBe("c2");
    const items = container.querySelectorAll("li");
    expect(items[0].textContent).toContain("desc-m1");
    expect(items[4].textContent).toContain("desc-m9");
  });

  it("resets to five rows when the parent-owned account filter changes", async () => {
    movements = Array.from({ length: 30 }, (_, n) =>
      dated(n, { account_id: n % 2 === 0 ? "a1" : "a2" }),
    );
    const { container } = renderHistoryWithAccountFilter();
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(5));
    fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
    fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(25));

    const accountSelect = screen.getByLabelText("Cuenta") as HTMLSelectElement;
    fireEvent.change(accountSelect, { target: { value: "a2" } });
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(5));
    expect(accountSelect.value).toBe("a2");
    const items = container.querySelectorAll("li");
    expect(items[0].textContent).toContain("desc-m1");
    expect(items[4].textContent).toContain("desc-m9");
  });

  it("composes direction and category filters", async () => {
    movements = [
      wire("e1", { direction: "expense", category_id: "c1" }),
      wire("e2", { direction: "expense", category_id: "c2" }),
      wire("i1", { direction: "income", category_id: "c2" }),
    ];
    renderHistory();
    await screen.findByText(/desc-e1/);
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "expense" } });
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "c2" } });
    await waitFor(() => expect(screen.queryByText(/desc-e1/)).not.toBeInTheDocument());
    expect(screen.getByText(/desc-e2/)).toBeInTheDocument();
    expect(screen.queryByText(/desc-i1/)).not.toBeInTheDocument();
  });

  it("shows the account-click filter visibly and clears it", async () => {
    const onSelectAccount = vi.fn();
    movements = [wire("m1", { account_id: "a1" }), wire("m2", { account_id: "a2" })];
    renderHistory({ activeAccountId: "a1", onSelectAccount });
    await screen.findByText(/desc-m1/);
    expect(screen.queryByText(/desc-m2/)).not.toBeInTheDocument();
    expect(screen.getByText("Mostrando movimientos de Cuenta principal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(onSelectAccount).toHaveBeenCalledWith(null);
  });

  it("keeps a transfer visible when filtering by its destination account", async () => {
    movements = [
      wire("t1", {
        direction: "transfer",
        category_id: null,
        account_id: "a1",
        transfer_account_id: "a2",
      }),
    ];
    renderHistory({ activeAccountId: "a2" });
    expect(
      await screen.findByText(/Transferencia: Cuenta principal → Bolsillo/),
    ).toBeInTheDocument();
  });

  it("keeps a transfer visible by its origin and drops it for an unrelated account", async () => {
    movements = [
      wire("t1", {
        direction: "transfer",
        category_id: null,
        account_id: "a1",
        transfer_account_id: "a2",
      }),
    ];
    const origin = renderHistory({ activeAccountId: "a1" });
    expect(
      await screen.findByText(/Transferencia: Cuenta principal → Bolsillo/),
    ).toBeInTheDocument();
    origin.unmount();

    renderHistory({ activeAccountId: "a9" });
    expect(await screen.findByText("Sin movimientos aún")).toBeInTheDocument();
    expect(screen.queryByText(/Transferencia:/)).not.toBeInTheDocument();
  });

  it("renders an independent Spanish empty state", async () => {
    movements = [];
    renderHistory();
    expect(await screen.findByText("Sin movimientos aún")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver más" })).not.toBeInTheDocument();
  });

  it("renders an independent error panel whose retry revalidates only finance/movements", async () => {
    movements = [wire("m1")];
    server.use(
      http.get("http://test.local/api/movements", () => {
        movementsGets += 1;
        return HttpResponse.json(null, { status: 500 });
      }),
    );
    renderHistory();
    expect(await screen.findByText("No se pudieron cargar los movimientos")).toBeInTheDocument();
    const getsBefore = movementsGets;
    server.use(
      http.get("http://test.local/api/movements", () => {
        movementsGets += 1;
        return HttpResponse.json(movements);
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByText(/desc-m1/);
    expect(movementsGets).toBeGreaterThan(getsBefore);
  });

  it("wires the edit affordance to onEdit", async () => {
    const onEdit = vi.fn();
    movements = [wire("m1")];
    renderHistory({ onEdit });
    const row = (await screen.findByText(/desc-m1/)).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /Editar movimiento/ }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });

  it("renders the transfer route copy with its own tone and badge", async () => {
    movements = [
      wire("t1", {
        direction: "transfer",
        category_id: null,
        transfer_account_id: "a2",
        description: null,
      }),
    ];
    renderHistory();
    const meta = await screen.findByText(/Transferencia: Cuenta principal → Bolsillo/);
    const row = meta.closest("li") as HTMLElement;
    expect(row).toHaveAttribute("data-direction", "transfer");
    expect(row.className).toContain("border-signal");
    expect(within(row).getByTestId("movement-transfer-badge")).toHaveTextContent("Transferencia");
    expect(within(row).queryByText(/Ingreso/)).not.toBeInTheDocument();
  });

  it("labels an unknown transfer destination instead of showing its id", async () => {
    movements = [
      wire("t1", {
        direction: "transfer",
        category_id: null,
        account_id: "a1",
        transfer_account_id: "cuenta-archivada",
      }),
    ];
    renderHistory();
    expect(
      await screen.findByText(/Transferencia: Cuenta principal → Cuenta no disponible/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/cuenta-archivada/)).not.toBeInTheDocument();
  });

  it("offers delete but no edit on a transfer row", async () => {
    movements = [
      wire("t1", { direction: "transfer", category_id: null, transfer_account_id: "a2" }),
    ];
    renderHistory();
    const row = (await screen.findByText(/Transferencia: Cuenta principal → Bolsillo/)).closest(
      "li",
    ) as HTMLElement;
    expect(within(row).queryByRole("button", { name: /Editar movimiento/ })).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /Eliminar/ })).toBeInTheDocument();
  });

  it("deletes a transfer after confirmation", async () => {
    let deleted = 0;
    server.use(
      http.delete("http://test.local/api/movements/:id", () => {
        deleted += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    movements = [
      wire("t1", { direction: "transfer", category_id: null, transfer_account_id: "a2" }),
    ];
    renderHistory();
    const row = (await screen.findByText(/Transferencia: Cuenta principal → Bolsillo/)).closest(
      "li",
    ) as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /Eliminar/ }));
    fireEvent.click(within(row).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(deleted).toBe(1));
  });

  it("widens the direction filter with the transfer option", async () => {
    movements = [
      wire("e1", { direction: "expense" }),
      wire("t1", { direction: "transfer", category_id: null, transfer_account_id: "a2" }),
    ];
    renderHistory();
    await screen.findByText(/desc-e1/);
    const filter = screen.getByLabelText("Tipo") as HTMLSelectElement;
    expect(within(filter).getByRole("option", { name: "Transferencia" })).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "transfer" } });
    await waitFor(() => expect(screen.queryByText(/desc-e1/)).not.toBeInTheDocument());
    expect(screen.getByText(/Transferencia: Cuenta principal → Bolsillo/)).toBeInTheDocument();
  });

  it("labels the expense meta with the payment method and the income meta with its account", async () => {
    movements = [
      wire("e1", { direction: "expense", account_id: "a1" }),
      wire("i1", { direction: "income", category_id: "c2", account_id: "a2" }),
    ];
    renderHistory();
    expect(await screen.findByText(/Método de pago: Cuenta principal/)).toBeInTheDocument();
    expect(screen.getByText(/Cuenta: Bolsillo/)).toBeInTheDocument();
  });
});
