import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import FinanceScreens from "@/components/containers/FinanceScreens";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

// S-F: no handler serves /debts or /savings-goals anymore. Any regression
// reintroducing a read of those routes fails the type check (the hooks are
// deleted) or lands here as an unhandled request.
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
  http.get("http://test.local/api/me", () => {
    return HttpResponse.json({ preferences: { currency_code: "COP", locale: "es-CO" } });
  }),
  http.get("http://test.local/api/categories", () => {
    // S-C kind-free: a single unfiltered set for every picker and chart.
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
        kind: "subscription",
        name: "Transporte",
        color: null,
        icon: null,
        is_archived: false,
        created_at: "2026-09-01T00:00:00Z",
      },
    ]);
  }),
  http.get("http://test.local/api/movements", () => {
    return HttpResponse.json([
      {
        id: "m2",
        direction: "income",
        amount: "80000.00",
        occurred_on: "2026-09-08",
        description: "Sueldo",
        account_id: "a2",
        category_id: "c1",
        subscription_id: null,
        created_at: "2026-09-08T10:00:00Z",
        updated_at: "2026-09-08T10:00:00Z",
      },
      {
        id: "m1",
        direction: "expense",
        amount: "25000.00",
        occurred_on: "2026-09-07",
        description: "Mercado semanal",
        account_id: "a1",
        category_id: "c1",
        subscription_id: null,
        created_at: "2026-09-07T10:00:00Z",
        updated_at: "2026-09-07T10:00:00Z",
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

  it("renders subscriptions with money detail and no debts/savings sections", async () => {
    renderScreens();
    // PR-3 FIX A: SubscriptionRow duplica el nombre (lectura + gestión); ambas visibles.
    expect((await screen.findAllByText("Music")).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText("Cargos recurrentes activos.")).toBeInTheDocument();
    // S-F: the Savings and Debts sections, controls and placeholders are gone.
    expect(screen.queryByRole("region", { name: "Deudas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Ahorros" })).not.toBeInTheDocument();
    expect(screen.queryByText("Saldos restantes.")).not.toBeInTheDocument();
    expect(screen.queryByText("Progreso de las metas.")).not.toBeInTheDocument();
    expect(screen.queryByText("Sin deudas")).not.toBeInTheDocument();
    expect(screen.queryByText("Sin metas de ahorro aún")).not.toBeInTheDocument();
  });

  it("renders the movements history from GET /movements in API order", async () => {
    renderScreens();
    const history = await screen.findByRole("region", { name: "Movimientos" });
    // Descriptions render inside a shared meta line — match by substring.
    expect(await within(history).findByText(/Sueldo/)).toBeInTheDocument();
    expect(within(history).getByText(/Mercado semanal/)).toBeInTheDocument();
  });

  it("renders the two-series category chart from movement aggregates", async () => {
    renderScreens();
    const chart = await screen.findByRole("region", { name: "Gastos e ingresos por categoría" });
    // The kind-free picker lists finance + subscription kinds together.
    const select = within(chart).getByLabelText("Categoría");
    expect(within(select).getByRole("option", { name: "Alimentación" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Transporte" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "c1" } });
    // Both directions aggregate without netting: gasto + ingreso series mount.
    expect(await within(chart).findByRole("progressbar", { name: "Gastos" })).toBeInTheDocument();
    expect(within(chart).getByRole("progressbar", { name: "Ingresos" })).toBeInTheDocument();
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

  it("shows empty states when every surviving finance endpoint returns nothing", async () => {
    server.use(
      http.get("http://test.local/api/accounts", () => HttpResponse.json([])),
      http.get("http://test.local/api/subscriptions", () => HttpResponse.json([])),
      http.get("http://test.local/api/movements", () => HttpResponse.json([])),
    );
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <FinanceScreens />
      </SWRConfig>,
    );
    expect(await screen.findByText("Sin cuentas aún")).toBeInTheDocument();
    expect(await screen.findByText("Sin suscripciones activas")).toBeInTheDocument();
    expect(await screen.findByText("Sin movimientos aún")).toBeInTheDocument();
    expect(await screen.findByText("Sin movimientos en esta categoría aún")).toBeInTheDocument();
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

// -- S5 escritura superviviente (RED: mutadores + forms por dominio, montos string) --
import {
  createBankAccount,
  createSubscription,
  createValuation,
  deleteSubscription,
  patchAsset,
  setSubscriptionActive,
} from "@/lib/api/finance";
import { SubscriptionRow } from "@/components/finance/SubscriptionForms";
import { AssetEditForm, AssetValuationForm } from "@/components/finance/AssetForms";

describe("finance S5 mutators", () => {
  it("subs/assets/bank-accounts usan endpoints PR-1 con montos string", async () => {
    server.use(
      http.post("http://test.local/api/subscriptions", () => HttpResponse.json({ id: "s9" })),
      http.patch("http://test.local/api/subscriptions/s1", () => HttpResponse.json({ id: "s1" })),
      http.delete("http://test.local/api/subscriptions/s1", () => new HttpResponse(null, { status: 204 })),
      http.post("http://test.local/api/accounts", () => HttpResponse.json({ id: "a9" })),
      http.patch("http://test.local/api/assets/a1", () => HttpResponse.json({ id: "a1" })),
      http.post("http://test.local/api/assets/a1/valuations", () => HttpResponse.json({ id: "v1" })),
    );
    await createSubscription({ name: "Streaming", price: "19900" });
    await setSubscriptionActive("s1", false);
    await deleteSubscription("s1");
    await createBankAccount("Cuenta nueva");
    await patchAsset("a1", { name: "Apartamento" });
    await createValuation("a1", { value: "1200.00", recorded_on: "2026-09-09" });
  });
});

describe("finance S5 forms", () => {
  const accs = [{ id: "a1", name: "Billetera" }];

  it("SubscriptionRow muestra precio y cancela/reactiva por PATCH widened (crear/editar vive en Ajustes)", async () => {
    server.use(
      http.patch("http://test.local/api/subscriptions/s1", () => HttpResponse.json({ id: "s1" })),
    );
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <SubscriptionRow sub={{ id: "s1", name: "Música", price: "19900.00", currency: "COP", frequency: "monthly", next_billing_on: null, is_active: true }} />
      </SWRConfig>,
    );
    // Row shows the COP price; the create/edit form is no longer Finance-resident.
    expect(screen.getByText(/19\.900/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Crear suscripción/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancelar/ })).toBeInTheDocument();
  });

  it("la sección de tarjetas fue eliminada de Finanzas", () => {
    expect(screen.queryByRole("button", { name: /Crear tarjeta/ })).not.toBeInTheDocument();
  });

  it("la shell de suscripciones muestra filas con Pay y sin formulario residente (crear vive en Ajustes)", async () => {
    renderScreens();
    const subs = await screen.findByRole("region", { name: "Suscripciones: crear y gestionar" });
    // Rows (with Pay) survive; the create/edit form — and its kind-split
    // category select — moved to Settings in S-D.
    expect(await within(subs).findByText("Music")).toBeInTheDocument();
    expect(await within(subs).findByRole("button", { name: "Pagar" })).toBeInTheDocument();
    expect(within(subs).queryByLabelText("Categoría")).not.toBeInTheDocument();
    expect(within(subs).queryByRole("button", { name: /Crear suscripción/ })).not.toBeInTheDocument();
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

// -- PR-3 FIX A (GREEN: SubscriptionRow cancelar/reactivar/eliminar + Pay) --
describe("finance PR-3 FIX A", () => {
  it("monta SubscriptionRow cancelar/reactivar/eliminar con Pay en su lista", async () => {
    renderScreens();
    expect(await screen.findByRole("button", { name: /Cancelar/ })).toBeInTheDocument();
    expect((await screen.findAllByRole("button", { name: "Eliminar" })).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByRole("button", { name: "Pagar" })).length).toBeGreaterThanOrEqual(1);
  });
});
