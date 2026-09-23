import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import {
  apiDelete,
  apiPost,
  resetAuthRedirectForTests,
  setToken,
} from "@/lib/api/client";
import {
  deleteAccount,
  fetchFinanceCategories,
  patchAccount,
} from "@/lib/api/finance";
import {
  normalizeManualAmount,
  toAccountOptions,
  toCategoryOptions,
} from "@/lib/finance/finance";
import { AccountBalanceEdit, isValidBalanceInput } from "@/components/containers/FinanceScreens";
import type { AccountCardView } from "@/lib/finance/finance";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

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

const seenPatches: { url: string; body: unknown }[] = [];
const seenDeletes: string[] = [];

const server = setupServer(
  http.get("http://test.local/api/categories", ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.get("kind") === "finance") return HttpResponse.json(categories);
    return HttpResponse.json(categories);
  }),
  http.patch("http://test.local/api/accounts/:id", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    seenPatches.push({ url: request.url, body });
    return HttpResponse.json({ id: "a-src", balance: body["balance"] });
  }),
  http.delete("http://test.local/api/accounts/:id", ({ request }) => {
    seenDeletes.push(request.url);
    return new HttpResponse(null, { status: 204 });
  }),
  http.post("http://test.local/api/echo", async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({ seen: body });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seenPatches.length = 0;
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

const card: AccountCardView = {
  id: "a-src",
  name: "Ahorros",
  type: "cash",
  currency: "COP",
  balance: 1500000,
  isCard: false,
  used: null,
  available: null,
  usagePct: null,
  alertLevel: null,
  statementBalance: null,
};

describe("S1 api helpers (saldos manuales, sin UUIDs visibles)", () => {
  it("patches an account balance as a decimal string", async () => {
    setToken("tok");
    await patchAccount("a-src", { balance: "980000.00" });
    expect(seenPatches[0].url).toContain("/accounts/a-src");
    expect(seenPatches[0].body).toMatchObject({ balance: "980000.00" });
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

describe("inline balance edit (S3b, diseño §6.2)", () => {
  it("guards the client input with the server shape and |v| < 1e6", () => {
    expect(isValidBalanceInput("980000.00")).toBe(true);
    expect(isValidBalanceInput("-750.50")).toBe(true);
    expect(isValidBalanceInput("0")).toBe(true);
    expect(isValidBalanceInput("10.005")).toBe(false);
    expect(isValidBalanceInput("1000000.00")).toBe(false);
    expect(isValidBalanceInput("abc")).toBe(false);
    expect(isValidBalanceInput("")).toBe(false);
  });

  it("shows the current value and opens the edit with a per-account label", () => {
    renderWithSWR(<AccountBalanceEdit account={card} locale="es-CO" />);
    expect(screen.getByText("Ahorros")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Editar saldo de Ahorros" }));
    expect(screen.getByLabelText("Editar saldo de Ahorros")).toHaveValue("1500000");
  });

  it("blocks invalid input in Spanish without a request", async () => {
    renderWithSWR(<AccountBalanceEdit account={card} locale="es-CO" />);
    fireEvent.click(screen.getByRole("button", { name: "Editar saldo de Ahorros" }));
    const box = screen.getByLabelText("Editar saldo de Ahorros");
    fireEvent.change(box, { target: { value: "10.005" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("válido");
    expect(seenPatches).toHaveLength(0);
  });

  it("cancel sends nothing and restores the view", () => {
    renderWithSWR(<AccountBalanceEdit account={card} locale="es-CO" />);
    fireEvent.click(screen.getByRole("button", { name: "Editar saldo de Ahorros" }));
    const region = screen.getByLabelText("Editar saldo de Ahorros").closest("div")!;
    fireEvent.change(screen.getByLabelText("Editar saldo de Ahorros"), {
      target: { value: "999" },
    });
    fireEvent.click(within(region.parentElement!).getByRole("button", { name: "Cancelar" }));
    expect(seenPatches).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Editar saldo de Ahorros" })).toBeInTheDocument();
  });

  it("saves a valid balance as a string and collapses", async () => {
    setToken("tok");
    renderWithSWR(<AccountBalanceEdit account={card} locale="es-CO" />);
    fireEvent.click(screen.getByRole("button", { name: "Editar saldo de Ahorros" }));
    fireEvent.change(screen.getByLabelText("Editar saldo de Ahorros"), {
      target: { value: "980000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(seenPatches).toHaveLength(1));
    expect(seenPatches[0].body).toMatchObject({ balance: "980000" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Editar saldo de Ahorros" })).toBeInTheDocument(),
    );
  });
});
