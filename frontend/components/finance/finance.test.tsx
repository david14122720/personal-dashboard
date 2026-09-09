import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import FinanceScreens from "@/components/containers/FinanceScreens";
import { SavingsList } from "@/components/finance/FinanceSections";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const txPage1 = {
  items: [
    {
      id: "t3",
      account_id: "a1",
      type: "income",
      amount: "100.00",
      currency: "COP",
      occurred_on: "2026-09-03",
      category_id: null,
      description: "salary",
      notes: null,
      credit_card_account_id: null,
    },
    {
      id: "t2",
      account_id: "a1",
      type: "expense",
      amount: "20.00",
      currency: "COP",
      occurred_on: "2026-09-02",
      category_id: null,
      description: "groceries",
      notes: null,
      credit_card_account_id: null,
    },
  ],
  next_cursor: "CURSOR-PAGE-2",
  total_count: 3,
};

const txPage2 = {
  items: [
    {
      id: "t1",
      account_id: "a1",
      type: "expense",
      amount: "5.00",
      currency: "COP",
      occurred_on: "2026-09-01",
      category_id: null,
      description: "coffee",
      notes: null,
      credit_card_account_id: null,
    },
  ],
  next_cursor: null,
  total_count: 3,
};

const seenTxUrls: string[] = [];

const server = setupServer(
  http.get("http://test.local/api/transactions", ({ request }) => {
    seenTxUrls.push(request.url);
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    if (cursor === "CURSOR-PAGE-2") return HttpResponse.json(txPage2);
    return HttpResponse.json(txPage1);
  }),
  http.get("http://test.local/api/budgets", () => {
    return HttpResponse.json([
      {
        id: "b1",
        category_id: "c1",
        amount: "100.00",
        currency: "COP",
        period_start: "2026-09-01",
        period_end: "2026-09-30",
        spent: "85.00",
        remaining: "15.00",
        pct: 0.85,
        status: "warn",
      },
      {
        id: "b2",
        category_id: "c2",
        amount: "50.00",
        currency: "COP",
        period_start: "2026-09-01",
        period_end: "2026-09-30",
        spent: "60.00",
        remaining: "-10.00",
        pct: 1.2,
        status: "over",
      },
    ]);
  }),
  http.get("http://test.local/api/accounts", () => {
    return HttpResponse.json([
      {
        id: "a1",
        name: "Visa",
        type: "credit_card",
        currency: "COP",
        balance: "-500.00",
        credit_limit: "2000.00",
        used_balance: "500.00",
        available_balance: "1500.00",
        usage_pct: "25.00",
        alert_level: "warn",
        statement_balance: "320.50",
      },
      {
        id: "a2",
        name: "Wallet",
        type: "cash",
        currency: "COP",
        balance: "200.00",
        alert_level: null,
      },
    ]);
  }),
  http.get("http://test.local/api/subscriptions", () => {
    return HttpResponse.json([
      {
        id: "s1",
        name: "Music",
        price: "9.99",
        currency: "USD",
        frequency: "monthly",
        next_billing_on: "2026-10-01",
        is_active: true,
      },
    ]);
  }),
  http.get("http://test.local/api/debts", () => {
    return HttpResponse.json([
      {
        id: "d1",
        name: "Loan",
        creditor: "Bank",
        original_amount: "500.00",
        pending_amount: "320.00",
        currency: "COP",
        status: "active",
        due_date: "2026-12-01",
      },
    ]);
  }),
  http.get("http://test.local/api/savings-goals", () => {
    return HttpResponse.json([
      {
        id: "g1",
        name: "Trip",
        target_amount: "1000.00",
        saved_amount: "250.00",
        currency: "COP",
        is_completed: false,
        target_date: "2026-12-31",
      },
    ]);
  }),
  http.get("http://test.local/api/me", () => {
    return HttpResponse.json({ preferences: { currency_code: "COP", locale: "es-CO" } });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seenTxUrls.length = 0;
});
afterAll(() => server.close());

function renderScreens() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <FinanceScreens />
    </SWRConfig>,
  );
}

function ledgerSection(): HTMLElement {
  return screen.getByRole("region", { name: "Libro de transacciones" });
}

describe("finance screens", () => {
  it("renders the ledger first page with count and a Load more button", async () => {
    renderScreens();
    const ledger = ledgerSection();
    expect(await within(ledger).findByText("salary")).toBeInTheDocument();
    expect(await within(ledger).findByText("groceries")).toBeInTheDocument();
    expect(await within(ledger).findByText("Mostrando 2 de 3 transacciones")).toBeInTheDocument();
    expect(within(ledger).getByRole("button", { name: "Cargar más" })).toBeInTheDocument();
  });

  it("appends page 2 through the opaque keyset cursor and hides Load more at the end", async () => {
    renderScreens();
    const ledger = ledgerSection();
    await within(ledger).findByText("groceries");

    fireEvent.click(within(ledger).getByRole("button", { name: "Cargar más" }));
    expect(await within(ledger).findByText("coffee")).toBeInTheDocument();
    expect(await within(ledger).findByText("Mostrando 3 de 3 transacciones")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(ledger).queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument();
    });
    expect(seenTxUrls.some((url) => url.includes("cursor=CURSOR-PAGE-2"))).toBe(true);
  });

  it("reuses the shared LED mapping for budget status and card alert levels", async () => {
    renderScreens();
    expect(await screen.findByRole("img", { name: "COP 100 · 2026-09-01, estado warn" })).toHaveClass("bg-signal");
    expect(await screen.findByRole("img", { name: "COP 50 · 2026-09-01, estado over" })).toHaveClass("bg-alert");
    expect(await screen.findByRole("img", { name: "Visa, estado warn" })).toHaveClass("bg-signal");
    expect(await screen.findByRole("progressbar", { name: "Gasto de COP 100 · 2026-09-01" })).toBeInTheDocument();
    expect(await screen.findByText("Gasto frente a cada presupuesto activo.")).toBeInTheDocument();
  });

  it("shows card usage metrics and the statement balance when present", async () => {
    renderScreens();
    const accounts = await screen.findByRole("region", { name: "Cuentas" });
    expect(within(accounts).getByText("Visa")).toBeInTheDocument();
    expect(within(accounts).getByText(/25\.0%/)).toBeInTheDocument();
    expect(within(accounts).getByText(/extracto/)).toBeInTheDocument();
    expect(within(accounts).getByText("Wallet")).toBeInTheDocument();
    expect(await screen.findByRole("progressbar", { name: "Uso de tarjeta de Visa" })).toBeInTheDocument();
    expect(await screen.findByText("Saldos y uso de tarjetas de crédito.")).toBeInTheDocument();
  });

  it("renders subscriptions, debts, and savings with money detail", async () => {
    renderScreens();
    expect(await screen.findByText("Music")).toBeInTheDocument();
    expect(await screen.findByText("Loan · Bank")).toBeInTheDocument();
    expect(await screen.findByText("Trip")).toBeInTheDocument();
    expect(await screen.findByText("25% ahorrado")).toBeInTheDocument();
    expect(await screen.findByRole("progressbar", { name: "Progreso de Trip" })).toBeInTheDocument();
    expect(await screen.findByText("Cargos recurrentes activos.")).toBeInTheDocument();
    expect(await screen.findByText("Saldos restantes.")).toBeInTheDocument();
    expect(await screen.findByText("Progreso de las metas.")).toBeInTheDocument();
  });

  it("renders ledger filters, headers, and money details in Spanish", async () => {
    renderScreens();
    const ledger = ledgerSection();
    const filters = within(ledger).getByRole("form", { name: "Filtros de transacciones" });
    expect(within(filters).getByText("Desde")).toBeInTheDocument();
    expect(within(filters).getByText("Hasta")).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: "Aplicar" })).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: "Limpiar" })).toBeInTheDocument();
    expect(await within(ledger).findByRole("columnheader", { name: "Fecha" })).toBeInTheDocument();
    expect(await within(ledger).findByRole("columnheader", { name: "Descripción" })).toBeInTheDocument();
    expect((await screen.findAllByText(/restantes$/)).length).toBe(2);
    expect((await screen.findAllByText(/% gastado/)).length).toBe(2);
    expect(await screen.findByText(/usados/)).toBeInTheDocument();
    expect(await screen.findByText(/extracto/)).toBeInTheDocument();
  });

  it("shows empty states when every finance endpoint returns nothing", async () => {
    server.use(
      http.get("http://test.local/api/transactions", () => {
        return HttpResponse.json({ items: [], next_cursor: null, total_count: 0 });
      }),
      http.get("http://test.local/api/budgets", () => HttpResponse.json([])),
      http.get("http://test.local/api/accounts", () => HttpResponse.json([])),
      http.get("http://test.local/api/subscriptions", () => HttpResponse.json([])),
      http.get("http://test.local/api/debts", () => HttpResponse.json([])),
      http.get("http://test.local/api/savings-goals", () => HttpResponse.json([])),
    );
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <FinanceScreens />
      </SWRConfig>,
    );
    const ledger = ledgerSection();
    expect(await within(ledger).findByText("Sin transacciones aún")).toBeInTheDocument();
    expect(await screen.findByText("Sin presupuestos aún")).toBeInTheDocument();
    expect(await screen.findByText("Sin cuentas aún")).toBeInTheDocument();
    expect(await screen.findByText("Sin suscripciones activas")).toBeInTheDocument();
    expect(await screen.findByText("Sin deudas")).toBeInTheDocument();
    expect(await screen.findByText("Sin metas de ahorro aún")).toBeInTheDocument();
    expect(await screen.findByText("Crea una meta para seguir tu progreso aquí.")).toBeInTheDocument();
  });

  it("marks completed savings goals with a Spanish badge", () => {
    render(
      <SavingsList
        goals={[
          {
            id: "g1",
            title: "Trip",
            detail: null,
            amount: 1000,
            currency: "COP",
            progress: 1,
            completed: true,
          },
        ]}
        locale="es-CO"
      />,
    );
    expect(screen.getByText("Completada")).toBeInTheDocument();
  });

  it("shows an error alert with retry when aggregate reads fail", async () => {
    server.use(http.get("http://test.local/api/budgets", () => HttpResponse.error()));
    render(
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        <FinanceScreens />
      </SWRConfig>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar las secciones de finanzas");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("shows a Spanish ledger alert with retry when transactions fail to load", async () => {
    server.use(http.get("http://test.local/api/transactions", () => HttpResponse.error()));
    render(
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        <FinanceScreens />
      </SWRConfig>,
    );
    const ledger = ledgerSection();
    expect(await within(ledger).findByRole("alert")).toHaveTextContent("No se pudieron cargar las transacciones");
    expect(within(ledger).getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("shows a Spanish alert when loading more transactions fails", async () => {
    server.use(
      http.get("http://test.local/api/transactions", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("cursor")) return HttpResponse.error();
        return HttpResponse.json(txPage1);
      }),
    );
    renderScreens();
    const ledger = ledgerSection();
    await within(ledger).findByText("groceries");
    fireEvent.click(within(ledger).getByRole("button", { name: "Cargar más" }));
    expect(await within(ledger).findByRole("alert")).toHaveTextContent("No se pudieron cargar más transacciones");
  });
});
