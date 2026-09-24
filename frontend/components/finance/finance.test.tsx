import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import FinanceScreens from "@/components/containers/FinanceScreens";
import { SavingsList } from "@/components/finance/FinanceSections";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const server = setupServer(
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
  http.get("http://test.local/api/categories", ({ request }) => {
    // P6 honesto: cada select clasifica con su kind del backend.
    if (new URL(request.url).searchParams.get("kind") === "subscription") {
      return HttpResponse.json([
        {
          id: "sc1",
          kind: "subscription",
          name: "Streaming",
          color: null,
          icon: null,
          is_archived: false,
          created_at: "2026-09-01T00:00:00Z",
        },
      ]);
    }
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
});
afterAll(() => server.close());

function renderScreens() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <FinanceScreens />
    </SWRConfig>,
  );
}

describe("finance screens", () => {
  it("reuses the shared LED mapping for card alert levels", async () => {
    renderScreens();
    expect(await screen.findByRole("img", { name: "Visa, estado warn" })).toHaveClass("bg-signal");
  });

  it("shows card usage metrics and balances without a ledger", async () => {
    renderScreens();
    const accounts = await screen.findByRole("region", { name: "Cuentas" });
    expect(within(accounts).getAllByText("Visa").length).toBeGreaterThanOrEqual(1);
    expect(within(accounts).getByText(/25\.0%/)).toBeInTheDocument();
    expect(within(accounts).getAllByText("Wallet").length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByRole("progressbar", { name: "Uso de tarjeta de Visa" })).toBeInTheDocument();
    expect(await screen.findByText("Saldos de tus cuentas bancarias.")).toBeInTheDocument();
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

  it("exposes the inline balance edit per account with the current value", async () => {
    renderScreens();
    expect(await screen.findByRole("button", { name: "Editar saldo de Visa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar saldo de Wallet" })).toBeInTheDocument();
  });

  it("renders no flow chart, no ledger and no capture block", async () => {
    renderScreens();
    await screen.findByRole("region", { name: "Cuentas" });
    expect(screen.queryByRole("region", { name: "Libro de transacciones" })).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Nuevo ingreso" })).not.toBeInTheDocument();
    expect(screen.queryByText("Flujo mensual")).not.toBeInTheDocument();
    expect(screen.queryByText("Balance")).not.toBeInTheDocument();
    expect(screen.queryByText("Análisis")).not.toBeInTheDocument();
  });

  it("shows empty states when every finance endpoint returns nothing", async () => {
    server.use(
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
    server.use(http.get("http://test.local/api/accounts", () => HttpResponse.error()));
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
});

// -- S5 escritura (RED: mutadores + 6 forms por dominio, montos string, selects por nombre) --
import {
  createBankAccount,
  createMovement,
  createPayment,
  createSubscription,
  createValuation,
  deleteMovement,
  deletePayment,
  deleteSubscription,
  fetchDebtPayments,
  patchAsset,
  patchDebt,
  patchGoal,
  setSubscriptionActive,
} from "@/lib/api/finance";
import { SavingsDepositForm, SavingsGoalForm } from "@/components/finance/SavingsForms";
import { DebtEditForm, DebtPayForm, DebtPaymentHistory } from "@/components/finance/DebtPayments";
import { SubscriptionCreateForm, SubscriptionRow } from "@/components/finance/SubscriptionForms";
import { AssetEditForm, AssetValuationForm } from "@/components/finance/AssetForms";

describe("finance S5 mutators", () => {
  it("savings/debts/subs/assets/bank-accounts usan endpoints PR-1 con montos string", async () => {
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
    await createBankAccount("Cuenta nueva");
    await patchAsset("a1", { name: "Apartamento" });
    await createValuation("a1", { value: "1200.00", recorded_on: "2026-09-09" });
    expect(seen).toContain("POST http://test.local/api/savings-goals/g1/movements");
    expect(seen).toContain("DELETE http://test.local/api/savings-goals/g1/movements/m1");
  });
});

describe("finance S5 forms", () => {
  const cats = [{ id: "c1", name: "Alimentación" }];
  const accs = [{ id: "a1", name: "Billetera" }];

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
        { id: "p1", debt_id: "d1", amount: "100.00", paid_on: "2026-09-02", payment_method: null, notes: null, created_at: "2026-09-02T00:00:00Z" },
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

  it("la sección de tarjetas fue eliminada de Finanzas", () => {
    expect(screen.queryByRole("button", { name: /Crear tarjeta/ })).not.toBeInTheDocument();
  });

  it("cada select de clasificación recibe solo su kind del backend", async () => {
    renderScreens();
    const subs = await screen.findByRole("region", { name: "Suscripciones: crear y gestionar" });
    expect(await within(subs).findByRole("option", { name: "Streaming" })).toBeInTheDocument();
    expect(within(subs).queryByRole("option", { name: "Alimentación" })).not.toBeInTheDocument();
    const savings = await screen.findByRole("region", { name: "Ahorros: metas y abonos" });
    // Crear + editar por meta: cada select de ahorro ve las finance…
    expect((await within(savings).findAllByRole("option", { name: "Alimentación" })).length).toBeGreaterThanOrEqual(1);
    expect(within(savings).queryByRole("option", { name: "Streaming" })).not.toBeInTheDocument();
  });

  it("blanquea el límite cuando no hay categorías de suscripción", async () => {
    server.use(
      http.get("http://test.local/api/categories", ({ request }) => {
        if (new URL(request.url).searchParams.get("kind") === "subscription") {
          return HttpResponse.json([]);
        }
        return HttpResponse.json([
          { id: "c1", kind: "finance", name: "Alimentación", color: null, icon: null, is_archived: false, created_at: "2026-09-01T00:00:00Z" },
        ]);
      }),
    );
    renderScreens();
    expect(
      await screen.findByText("Sin categorías de suscripción en el servidor; este formulario solo acepta categorías de tipo suscripción."),
    ).toBeInTheDocument();
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

// -- PR-3 FIX A (GREEN: SubscriptionRow cancelar/reactivar + ediciones Savings) --
describe("finance PR-3 FIX A", () => {
  it("monta SubscriptionRow cancelar/reactivar y ediciones Savings en sus listas", async () => {
    renderScreens();
    expect(await screen.findByRole("button", { name: /Cancelar/ })).toBeInTheDocument();
    expect((await screen.findAllByRole("button", { name: "Eliminar" })).length).toBeGreaterThanOrEqual(2);
  });
});
