import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import TransactionsLedger from "@/components/finance/TransactionsLedger";
import TransferHistory from "@/components/finance/TransferHistory";
import { ExpenseForm, IncomeForm, TransferForm } from "@/components/finance/ManualCapture";
import {
  apiDelete,
  apiPost,
  resetAuthRedirectForTests,
  setToken,
} from "@/lib/api/client";
import {
  buildTransfersPath,
  createTransaction,
  createTransfer,
  deleteAccount,
  fetchFinanceCategories,
  fetchTransfersPage,
  transfersPageKey,
} from "@/lib/api/finance";
import {
  normalizeManualAmount,
  toAccountOptions,
  toCategoryOptions,
  toTransferRows,
  transferKey,
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
const seenTransferUrls: string[] = [];

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
  http.post("http://test.local/api/transfers", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    seenPosts.push({ url: request.url, body });
    return HttpResponse.json(
      {
        transfer_group_id: "g-new",
        legs: [
          {
            id: "leg-out",
            account_id: body["from_account_id"],
            type: "transfer",
            amount: body["amount"],
            currency: "COP",
            occurred_on: body["occurred_on"],
            category_id: null,
            description: body["description"] ?? null,
            notes: null,
            credit_card_account_id: null,
          },
          {
            id: "leg-in",
            account_id: body["to_account_id"],
            type: "transfer",
            amount: body["amount"],
            currency: "COP",
            occurred_on: body["occurred_on"],
            category_id: null,
            description: body["description"] ?? null,
            notes: null,
            credit_card_account_id: null,
          },
        ],
      },
      { status: 201 },
    );
  }),
  http.get("http://test.local/api/transfers", ({ request }) => {
    seenTransferUrls.push(request.url);
    const url = new URL(request.url);
    if (url.searchParams.get("cursor") === "CURSOR-2") {
      return HttpResponse.json({
        items: [
          {
            transfer_group_id: "g-1",
            from_account_id: "a-src",
            to_account_id: "a-dst",
            amount: "50000.00",
            currency: "COP",
            occurred_on: "2026-09-01",
            description: "ahorro",
            created_at: "2026-09-01T00:00:00Z",
          },
        ],
        next_cursor: null,
        total_count: 3,
      });
    }
    return HttpResponse.json({
      items: [
        {
          transfer_group_id: "g-3",
          from_account_id: "a-src",
          to_account_id: "a-dst",
          amount: "100000.00",
          currency: "COP",
          occurred_on: "2026-09-03",
          category_id: undefined,
          description: "pago",
          created_at: "2026-09-03T00:00:00Z",
        },
        {
          transfer_group_id: "g-2",
          from_account_id: "a-dst",
          to_account_id: "a-src",
          amount: "25000.00",
          currency: "COP",
          occurred_on: "2026-09-02",
          description: null,
          created_at: "2026-09-02T00:00:00Z",
        },
      ],
      next_cursor: "CURSOR-2",
      total_count: 3,
    });
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
  seenTransferUrls.length = 0;
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
  it("serializes transfer filters and keeps the cursor opaque", () => {
    const path = buildTransfersPath({ from: "2026-09-01" }, "b3BhcXVlLW9wYXF1ZQ");
    expect(path).toContain("from=2026-09-01");
    expect(path).toContain("cursor=b3BhcXVlLW9wYXF1ZQ");
    expect(buildTransfersPath({}, null)).toBe("/transfers");
  });

  it("produces distinct SWR keys per cursor and filter set", () => {
    expect(transfersPageKey({}, null)).not.toBe(transfersPageKey({}, "abc"));
    expect(transferKey({ from: "2026-09-01" })).not.toBe(transferKey({}));
  });

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

  it("creates a transfer via POST /transfers with origin/dest ids", async () => {
    setToken("tok");
    const created = await createTransfer({
      from_account_id: "a-src",
      to_account_id: "a-dst",
      amount: "100000.00",
      occurred_on: "2026-09-05",
    });
    expect(created.transfer_group_id).toBe("g-new");
    expect(seenPosts[0].url).toContain("/transfers");
  });

  it("lists transfers with keyset pagination", async () => {
    setToken("tok");
    const page1 = await fetchTransfersPage({ limit: 2 }, null);
    expect(page1.items).toHaveLength(2);
    expect(page1.total_count).toBe(3);
    expect(page1.next_cursor).toBe("CURSOR-2");
    const page2 = await fetchTransfersPage({ limit: 2 }, page1.next_cursor);
    expect(page2.items).toHaveLength(1);
    expect(seenTransferUrls.some((url) => url.includes("cursor=CURSOR-2"))).toBe(true);
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

  it("coerces transfer history amounts to numbers", () => {
    const rows = toTransferRows([
      {
        transfer_group_id: "g-1",
        from_account_id: "a-src",
        to_account_id: "a-dst",
        amount: "100000.00",
        currency: "COP",
        occurred_on: "2026-09-03",
        description: "pago",
        created_at: "2026-09-03T00:00:00Z",
      },
    ]);
    expect(rows[0].amount).toBe(100000);
    expect(rows).toHaveLength(1);
    expect(toTransferRows(null)).toEqual([]);
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

  it("blocks a transfer with the same origin and destination in Spanish", async () => {
    renderWithSWR(<TransferForm />);
    const form = await screen.findByRole("form", { name: "Nueva transferencia" });
    fireEvent.change(within(form).getByLabelText("Monto (COP)"), {
      target: { value: "100000" },
    });
    fireEvent.change(within(form).getByLabelText("Cuenta origen"), {
      target: { value: "a-src" },
    });
    fireEvent.change(within(form).getByLabelText("Cuenta destino"), {
      target: { value: "a-src" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Guardar transferencia" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "El origen y el destino deben ser cuentas distintas.",
    );
    expect(seenPosts).toHaveLength(0);
  });

  it("saves a transfer chosen by account names", async () => {
    renderWithSWR(<TransferForm />);
    const form = await screen.findByRole("form", { name: "Nueva transferencia" });
    expect(await within(form).findAllByRole("option", { name: "Billetera" })).toHaveLength(2);
    fireEvent.change(within(form).getByLabelText("Monto (COP)"), {
      target: { value: "100000" },
    });
    fireEvent.change(within(form).getByLabelText("Cuenta origen"), {
      target: { value: "a-src" },
    });
    fireEvent.change(within(form).getByLabelText("Cuenta destino"), {
      target: { value: "a-dst" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Guardar transferencia" }));
    expect(await within(form).findByText("Transferencia guardada.")).toBeInTheDocument();
    expect(seenPosts[0].url).toContain("/transfers");
  });
});

describe("S1 transfer history (nombres, sin UUIDs)", () => {
  it("lists transfers with origin → destination names and Spanish count", async () => {
    renderWithSWR(<TransferHistory locale="es-CO" />);
    const region = screen.getByRole("region", { name: "Historial de transferencias" });
    expect(await within(region).findByText("Billetera → Banco")).toBeInTheDocument();
    expect(await within(region).findByText("Mostrando 2 de 3 transferencias")).toBeInTheDocument();
    expect(within(region).queryByText(/a-src/)).not.toBeInTheDocument();
    expect(within(region).queryByText(/g-3/)).not.toBeInTheDocument();
  });

  it("appends the next page through the opaque cursor", async () => {
    renderWithSWR(<TransferHistory locale="es-CO" />);
    const region = screen.getByRole("region", { name: "Historial de transferencias" });
    await within(region).findByText("Billetera → Banco");
    fireEvent.click(within(region).getByRole("button", { name: "Cargar más" }));
    expect(await within(region).findByText("Mostrando 3 de 3 transferencias")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        within(region).queryByRole("button", { name: "Cargar más" }),
      ).not.toBeInTheDocument();
    });
    expect(seenTransferUrls.some((url) => url.includes("cursor=CURSOR-2"))).toBe(true);
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
