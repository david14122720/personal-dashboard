import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("MovementHistory", () => {
  it("renders the latest 50 in API order", async () => {
    movements = Array.from({ length: 60 }, (_, n) => wire(`m${n}`));
    const { container } = renderHistory();
    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(50));
    const items = container.querySelectorAll("li");
    expect(items[0].textContent).toContain("desc-m0");
    expect(items[49].textContent).toContain("desc-m49");
    expect(container.textContent).not.toContain("desc-m59");
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

  it("renders an independent Spanish empty state", async () => {
    movements = [];
    renderHistory();
    expect(await screen.findByText("Sin movimientos aún")).toBeInTheDocument();
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
});
