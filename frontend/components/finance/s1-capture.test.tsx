import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import TransactionsLedger from "@/components/finance/TransactionsLedger";
import { ExpenseForm, IncomeForm } from "@/components/finance/ManualCapture";
import {
  apiDelete,
  apiPost,
  resetAuthRedirectForTests,
  setToken,
} from "@/lib/api/client";
import {
  createTransaction,
  deleteAccount,
  fetchFinanceCategories,
} from "@/lib/api/finance";
import {
  normalizeManualAmount,
  toAccountOptions,
  toCategoryOptions,
} from "@/lib/finance/finance";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const accounts = [
  { id: "a-src", name: "Billetera", type: "cash", currency: "COP", balance: "500.00" },
  { id: "a-dst", name: "Banco", type: "bank", currency: "COP", balance: "1000.00" },
];

const categories = [
  {
    id: "c-food",
    kind: "finance",
    name: "Alimentación",
    color: null,
    icon: null,
    is_archived: false,
    created_at: "2026-09-01T00:00:00Z",
  },
  {
    id: "c-trans",
    kind: "finance",
    name: "Transporte",
    color: null,
    icon: null,
    is_archived: false,
    created_at: "2026-09-01T00:00:00Z",
  },
];

const seenPosts: { url: string; body: unknown }[] = [];
const seenDeletes: string[] = [];

const server = setupServer(
  http.get("http://test.local/api/accounts", () => HttpResponse.json(accounts)),
  http.get("http://test.local/api/categories", ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.get("kind") === "finance") return HttpResponse.json(categories);
    return HttpResponse.json(categories);
  }),
  http.post("http://test.local/api/transactions", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    seenPosts.push({ url: request.url, body });
    return HttpResponse.json(
      {
        id: "t-new",
        account_id: body["account_id"],
        type: body["type"],
        amount: body["amount"],
        currency: "COP",
        occurred_on: body["occurred_on"],
        category_id: body["category_id"] ?? null,
        description: body["description"] ?? null,
        notes: null,
        credit_card_account_id: null,
      },
      { status: 201 },
    );
  }),
  http.delete("http://test.local/api/accounts/:id", ({ request }) => {
    seenDeletes.push(request.url);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get("http://test.local/api/transactions", () =>
    HttpResponse.json({ items: [], next_cursor: null, total_count: 0 }),
  ),
  http.post("http://test.local/api/echo", async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({ seen: body });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seenPosts.length = 0;
  seenDeletes.length = 0;
  localStorage.clear();
  resetAuthRedirectForTests();
});
afterAll(() => server.close());

function renderWithSWR(ui: React.ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>,
  );
}

describe("S1 api helpers (COP, sin UUIDs visibles)", () => {
  it("creates an income via POST /transactions type=income", async () => {
    setToken("tok");
    const created = await createTransaction({
      account_id: "a-src",
      type: "income",
      amount: "150000.00",
      occurred_on: "2026-09-05",
      category_id: "c-food",
      description: "Salario",
    });
    expect(created.type).toBe("income");
    expect(seenPosts[0].url).toContain("/transactions");
    expect(seenPosts[0].body).toMatchObject({ type: "income", amount: "150000.00" });
  });

  it("creates an expense via POST /transactions type=expense", async () => {
    setToken("tok");
    await createTransaction({
      account_id: "a-src",
      type: "expense",
      amount: "50000.00",
      occurred_on: "2026-09-05",
      payment_method: "efectivo",
    });
    expect(seenPosts[0].body).toMatchObject({ type: "expense", payment_method: "efectivo" });
  });

  it("lists finance categories ordered by name", async () => {
    setToken("tok");
    const rows = await fetchFinanceCategories();
    expect(rows.map((row) => row.name)).toEqual(["Alimentación", "Transporte"]);
    expect(rows.every((row) => row.kind === "finance")).toBe(true);
  });

  it("deletes an empty account via DELETE /accounts/{id}", async () => {
    setToken("tok");
    await deleteAccount("a-src");
    expect(seenDeletes[0]).toContain("/accounts/a-src");
  });

  it("apiPost sends JSON and apiDelete resolves 204 without a body", async () => {
    setToken("tok");
    const echoed = await apiPost<{ seen: unknown }>("/echo", { amount: "10.00" });
    expect(echoed).toMatchObject({ seen: { amount: "10.00" } });
    await expect(apiDelete("/accounts/a-src")).resolves.toBeUndefined();
  });
});

describe("S1 transforms (números solo en la frontera)", () => {
  it("normalizes hand-typed COP amounts to wire strings", () => {
    expect(normalizeManualAmount("150000")).toBe("150000");
    expect(normalizeManualAmount(" 150000.50 ")).toBe("150000.50");
    expect(normalizeManualAmount("0")).toBeNull();
    expect(normalizeManualAmount("-10")).toBeNull();
    expect(normalizeManualAmount("10.005")).toBeNull();
    expect(normalizeManualAmount("")).toBeNull();
    expect(normalizeManualAmount("abc")).toBeNull();
  });

  it("sorts account/category options by Spanish name", () => {
    expect(
      toAccountOptions([
        { id: "2", name: "Banco" },
        { id: "1", name: "Billetera" },
      ]).map((row) => row.name),
    ).toEqual(["Banco", "Billetera"]);
    expect(
      toCategoryOptions([
        {
          id: "2",
          kind: "finance",
          name: "Transporte",
          color: null,
          icon: null,
          is_archived: false,
          created_at: "",
        },
        {
          id: "1",
          kind: "finance",
          name: "Alimentación",
          color: null,
          icon: null,
          is_archived: false,
          created_at: "",
        },
      ]).map((row) => row.name),
    ).toEqual(["Alimentación", "Transporte"]);
  });
});

describe("S1 capture forms (español, selectores por nombre)", () => {
  it("renders the income form with Spanish labels and name selectors", async () => {
    renderWithSWR(<IncomeForm />);
    expect(await screen.findByRole("form", { name: "Nuevo ingreso" })).toBeInTheDocument();
    expect(screen.getByLabelText("Monto (COP)")).toBeInTheDocument();
    expect(screen.getByLabelText("Cuenta")).toBeInTheDocument();
    expect(screen.getByLabelText("Categoría")).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Billetera" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Alimentación" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("uuid")).not.toBeInTheDocument();
  });

  it("saves an income and shows a Spanish confirmation", async () => {
    renderWithSWR(<IncomeForm />);
    const form = await screen.findByRole("form", { name: "Nuevo ingreso" });
    fireEvent.change(within(form).getByLabelText("Monto (COP)"), {
      target: { value: "150000" },
    });
    fireEvent.change(within(form).getByLabelText("Cuenta"), { target: { value: "a-src" } });
    fireEvent.change(within(form).getByLabelText("Categoría"), { target: { value: "c-food" } });
    fireEvent.click(within(form).getByRole("button", { name: "Guardar ingreso" }));
    expect(await within(form).findByText("Movimiento guardado.")).toBeInTheDocument();
    expect(seenPosts[0].body).toMatchObject({ type: "income", amount: "150000" });
  });

  it("rejects a zero amount in Spanish without calling the API", async () => {
    renderWithSWR(<ExpenseForm />);
    const form = await screen.findByRole("form", { name: "Nuevo gasto" });
    fireEvent.change(within(form).getByLabelText("Monto (COP)"), { target: { value: "0" } });
    fireEvent.click(within(form).getByRole("button", { name: "Guardar gasto" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "Escribe un monto mayor a cero.",
    );
    expect(seenPosts).toHaveLength(0);
  });

  it("saves an expense with a simple payment-method selector", async () => {
    renderWithSWR(<ExpenseForm />);
    const form = await screen.findByRole("form", { name: "Nuevo gasto" });
    fireEvent.change(within(form).getByLabelText("Monto (COP)"), {
      target: { value: "50000" },
    });
    fireEvent.change(within(form).getByLabelText("Cuenta"), { target: { value: "a-src" } });
    fireEvent.change(within(form).getByLabelText("Método de pago"), {
      target: { value: "efectivo" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Guardar gasto" }));
    expect(await within(form).findByText("Movimiento guardado.")).toBeInTheDocument();
    expect(seenPosts[0].body).toMatchObject({ payment_method: "efectivo" });
  });
});

describe("S1 ledger filters (selectores, sin UUIDs)", () => {
  it("offers account/category selects by name without uuid placeholders", async () => {
    renderWithSWR(<TransactionsLedger locale="es-CO" />);
    const region = screen.getByRole("region", { name: "Libro de transacciones" });
    const filters = within(region).getByRole("form", { name: "Filtros de transacciones" });
    expect(within(filters).getByLabelText("Cuenta")).toBeInTheDocument();
    expect(within(filters).getByLabelText("Categoría")).toBeInTheDocument();
    expect(await within(filters).findByRole("option", { name: "Billetera" })).toBeInTheDocument();
    expect(
      await within(filters).findByRole("option", { name: "Alimentación" }),
    ).toBeInTheDocument();
    expect(within(filters).queryByPlaceholderText("uuid")).not.toBeInTheDocument();
  });
});
