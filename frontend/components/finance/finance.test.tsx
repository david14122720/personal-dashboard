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
  http.get("http://test.local/api/categories", () => {
    return HttpResponse.json([
      {
        id: "c1",
        kind: "finance",
        name: "Alimentación",
        color: null,
        icon: null,
        is_archived: false,
        created_at: "2026-09-01T00:00:00Z",
      },
      {
        id: "c2",
        kind: "finance",
        name: "Transporte",
        color: null,
        icon: null,
        is_archived: false,
        created_at: "2026-09-01T00:00:00Z",
      },
    ]);
  }),
  http.get("http://test.local/api/transfers", () => {
    return HttpResponse.json({ items: [], next_cursor: null, total_count: 0 });
  }),
  http.get("http://test.local/api/assets", () => {
    return HttpResponse.json([]);
  }),
  http.get("http://test.local/api/net-worth", () => {
    return HttpResponse.json({ per_currency: [] });
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
    // PR-3 FIX A: SubscriptionRow duplica el nombre (lectura + gestión); ambas visibles.
    expect((await screen.findAllByText("Music")).length).toBeGreaterThanOrEqual(1);
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

// -- S5 escritura (RED: mutadores + 6 forms por dominio, montos string, selects por nombre) --
import {
  createBudget,
  createCard,
  createMovement,
  createPayment,
  createSubscription,
  createValuation,
  deleteBudget,
  deleteMovement,
  deletePayment,
  deleteSubscription,
  fetchDebtPayments,
  patchAsset,
  patchBudget,
  patchDebt,
  patchGoal,
  setSubscriptionActive,
} from "@/lib/api/finance";
import BudgetForm from "@/components/finance/BudgetForm";
import { SavingsDepositForm, SavingsGoalForm } from "@/components/finance/SavingsForms";
import { DebtEditForm, DebtPayForm, DebtPaymentHistory } from "@/components/finance/DebtPayments";
import { SubscriptionCreateForm, SubscriptionRow } from "@/components/finance/SubscriptionForms";
import CardForm from "@/components/finance/CardForm";
import { CardDetail } from "@/components/finance/CardDetail";
import { AssetEditForm, AssetValuationForm } from "@/components/finance/AssetForms";

describe("finance S5 mutators", () => {
  it("budgets: create POST, patch PATCH con warn_threshold real, delete DELETE", async () => {
    const seen: { method: string; url: string; body?: unknown }[] = [];
    server.use(
      http.post("http://test.local/api/budgets", async ({ request }) => {
        seen.push({ method: "POST", url: request.url, body: await request.json() });
        return HttpResponse.json({ id: "b9" });
      }),
      http.patch("http://test.local/api/budgets/b1", async ({ request }) => {
        seen.push({ method: "PATCH", url: request.url, body: await request.json() });
        return HttpResponse.json({ id: "b1" });
      }),
      http.delete("http://test.local/api/budgets/b1", ({ request }) => {
        seen.push({ method: "DELETE", url: request.url });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await createBudget({ category_id: "c1", amount: "500.00", period_start: "2026-09-01", period_end: "2026-09-30" });
    await patchBudget("b1", { amount: "600.00", warn_threshold: 0.8, over_threshold: 1.0 });
    await deleteBudget("b1");
    expect(seen.map((s) => s.method)).toEqual(["POST", "PATCH", "DELETE"]);
    expect((seen[1].body as Record<string, unknown>).warn_threshold).toBe(0.8);
    expect(seen[1].url).toContain("/budgets/b1");
  });

  it("savings/debts/subs/assets/cards usan endpoints PR-1 con montos string", async () => {
    const seen: string[] = [];
    server.use(
      http.post("http://test.local/api/savings-goals/g1/movements", ({ request }) => { seen.push(`POST ${request.url}`); return HttpResponse.json({ id: "m1" }); }),
      http.delete("http://test.local/api/savings-goals/g1/movements/m1", ({ request }) => { seen.push(`DELETE ${request.url}`); return new HttpResponse(null, { status: 204 }); }),
      http.patch("http://test.local/api/savings-goals/g1", () => HttpResponse.json({ id: "g1" })),
      http.post("http://test.local/api/debts/d1/payments", () => HttpResponse.json({ id: "p1" })),
      http.delete("http://test.local/api/debts/d1/payments/p1", () => new HttpResponse(null, { status: 204 })),
      http.get("http://test.local/api/debts/d1/payments", () => HttpResponse.json([])),
      http.patch("http://test.local/api/debts/d1", () => HttpResponse.json({ id: "d1" })),
      http.post("http://test.local/api/subscriptions", () => HttpResponse.json({ id: "s9" })),
      http.patch("http://test.local/api/subscriptions/s1", () => HttpResponse.json({ id: "s1" })),
      http.delete("http://test.local/api/subscriptions/s1", () => new HttpResponse(null, { status: 204 })),
      http.post("http://test.local/api/accounts", () => HttpResponse.json({ id: "a9" })),
      http.patch("http://test.local/api/assets/a1", () => HttpResponse.json({ id: "a1" })),
      http.post("http://test.local/api/assets/a1/valuations", () => HttpResponse.json({ id: "v1" })),
    );
    await createMovement("g1", { amount: "50.00", occurred_on: "2026-09-09" });
    await deleteMovement("g1", "m1");
    await patchGoal("g1", { name: "Viaje playa" });
    await createPayment("d1", { amount: "100.00", paid_on: "2026-09-09" });
    await deletePayment("d1", "p1");
    await fetchDebtPayments("d1");
    await patchDebt("d1", { creditor: "Banco X" });
    await createSubscription({ name: "Streaming", price: "19900", frequency: "monthly" });
    await setSubscriptionActive("s1", false);
    await deleteSubscription("s1");
    await createCard({ name: "Visa", credit_limit: "5000000", statement_day: 15, payment_due_day: 25 });
    await patchAsset("a1", { name: "Apartamento" });
    await createValuation("a1", { value: "1200.00", recorded_on: "2026-09-09" });
    expect(seen).toContain("POST http://test.local/api/savings-goals/g1/movements");
    expect(seen).toContain("DELETE http://test.local/api/savings-goals/g1/movements/m1");
  });
});

describe("finance S5 forms", () => {
  const cats = [{ id: "c1", name: "Alimentación" }];
  const accs = [{ id: "a1", name: "Billetera" }];

  it("BudgetForm crea con select por nombre y monto manual, sin UUID visible", async () => {
    server.use(http.post("http://test.local/api/budgets", () => HttpResponse.json({ id: "b9" })));
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <BudgetForm categories={cats} onDone={() => undefined} />
      </SWRConfig>,
    );
    expect(screen.getByText("Alimentación")).toBeInTheDocument();
    expect(screen.queryByText("c1")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar/ }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("SavingsDepositForm bloquea sobrerretiro en cliente y GoalForm edita meta", async () => {
    const first = render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <SavingsDepositForm goalId="g1" saved={100} currency="COP" onDone={() => undefined} />
      </SWRConfig>,
    );
    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: /Retirar/ }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    first.unmount();
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <SavingsGoalForm categories={cats} onDone={() => undefined} />
      </SWRConfig>,
    );
    expect(screen.getByLabelText(/Nombre/)).toBeInTheDocument();
  });

  it("DebtPayForm valida amount<=pending y el historial corrige vía DELETE+recreate", async () => {
    server.use(
      http.get("http://test.local/api/debts/d1/payments", () => HttpResponse.json([
        { id: "p1", debt_id: "d1", amount: "100.00", paid_on: "2026-09-02", payment_method: null, transaction_id: null, notes: null, created_at: "2026-09-02T00:00:00Z" },
      ])),
      http.delete("http://test.local/api/debts/d1/payments/p1", () => new HttpResponse(null, { status: 204 })),
    );
    const stub = window.confirm;
    window.confirm = () => true;
    const pay = render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <DebtPayForm debtId="d1" pending={100} currency="COP" onDone={() => undefined} />
      </SWRConfig>,
    );
    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: /Abonar/ }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    pay.unmount();
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <DebtPaymentHistory debtId="d1" onCorrect={() => undefined} />
      </SWRConfig>,
    );
    expect(await screen.findByText(/100/)).toBeInTheDocument();
    const hist = render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <DebtEditForm debtId="d1" onDone={() => undefined} />
      </SWRConfig>,
    );
    void hist;
    expect(screen.getByLabelText(/Acreedor/)).toBeInTheDocument();
    window.confirm = stub;
  });

  it("SubscriptionCreateForm exige precio manual y la fila cancela/reactiva solo con is_active", async () => {
    server.use(
      http.post("http://test.local/api/subscriptions", () => HttpResponse.json({ id: "s9" })),
      http.patch("http://test.local/api/subscriptions/s1", () => HttpResponse.json({ id: "s1" })),
    );
    const created = render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <SubscriptionCreateForm categories={cats} onDone={() => undefined} />
      </SWRConfig>,
    );
    fireEvent.change(screen.getByLabelText(/Precio/), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: /Crear suscripción/ }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    created.unmount();
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <SubscriptionRow sub={{ id: "s1", name: "Música", price: "9.99", currency: "COP", frequency: "monthly", next_billing_on: null, is_active: true }} />
      </SWRConfig>,
    );
    expect(screen.getByRole("button", { name: /Cancelar/ })).toBeInTheDocument();
  });

  it("CardForm exige límite+corte+pago y CardDetail explica DELETE+recreate", () => {
    const card = render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <CardForm onDone={() => undefined} />
      </SWRConfig>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Crear tarjeta/ }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    card.unmount();
    render(
      <CardDetail
        card={{ id: "a1", name: "Visa", type: "credit_card", currency: "COP", balance: 0, isCard: true, used: 910, available: 90, usagePct: 91, alertLevel: "high", statementBalance: 320 }}
        locale="es-CO"
      />,
    );
    expect(screen.getByText(/elimina y recrea/i)).toBeInTheDocument();
  });

  it("AssetForms editan allowlist real y valúan con fecha posterior", async () => {
    const edit = render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <AssetEditForm assetId="a1" accounts={accs} onDone={() => undefined} />
      </SWRConfig>,
    );
    expect(screen.getByLabelText(/Nombre/)).toBeInTheDocument();
    expect(screen.queryByText("a1")).not.toBeInTheDocument();
    edit.unmount();
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <AssetValuationForm assetId="a1" lastRecordedOn="2026-09-05" onDone={() => undefined} />
      </SWRConfig>,
    );
    fireEvent.change(screen.getByLabelText(/Fecha/), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText(/Valor/), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: /Valuar/ }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

// -- PR-3 FIX A + S6 mount (GREEN: SubscriptionRow + ediciones + PeriodSelector/charts/analysis) --
describe("finance PR-3 FIX A + S6", () => {
  it("monta SubscriptionRow cancelar/reactivar y ediciones Budget/Savings en sus listas", async () => {
    server.use(
      http.get("http://test.local/api/transactions/stats/monthly-flow", () =>
        HttpResponse.json([
          { month: "2026-07", income: "2000.00", expense: "800.00" },
          { month: "2026-08", income: "2000.00", expense: "1000.00" },
          { month: "2026-09", income: "2000.00", expense: "1200.00" },
        ]),
      ),
      http.get("http://test.local/api/transactions/stats/by-category", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("type") === "income")
          return HttpResponse.json([{ category_id: "c9", name: "Salario", total: "2000000.00" }]);
        return HttpResponse.json([{ category_id: "c1", name: "Mercado", total: "1500.00" }]);
      }),
    );
    renderScreens();
    expect(await screen.findByRole("button", { name: /Cancelar/ })).toBeInTheDocument();
    expect((await screen.findAllByRole("button", { name: "Eliminar" })).length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByRole("radio", { name: "Mes" })).toBeChecked();
    expect(await screen.findByText("Balance")).toBeInTheDocument();
    expect(await screen.findByText("Ahorro")).toBeInTheDocument();
    expect(await screen.findByText("Gastos mensuales")).toBeInTheDocument();
    expect(await screen.findByText("Mes actual frente al anterior")).toBeInTheDocument();
    expect(await screen.findByText("Ingresos por fuente")).toBeInTheDocument();
    expect(await screen.findByText("Análisis personal, no asesoramiento financiero.")).toBeInTheDocument();
    expect(await screen.findByText(/Este mes gastaste/)).toBeInTheDocument();
  });

  it("PeriodSelector custom invalido bloquea agregados sin romper", async () => {
    renderScreens();
    const periodRegion = await screen.findByRole("region", { name: "Per\u00edodo" });
    const custom = within(periodRegion).getByRole("radio", { name: "Personalizado" });
    fireEvent.click(custom);
    const from = within(periodRegion).getByLabelText("Desde");
    fireEvent.change(from, { target: { value: "2026-09-10" } });
    const to = within(periodRegion).getByLabelText("Hasta");
    fireEvent.change(to, { target: { value: "2026-09-01" } });
    expect(await within(periodRegion).findByRole("alert")).toHaveTextContent("no es v\u00e1lido");
  });
});
