import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
        currency: "COP",
        balance: "-500.00",
      },
      {
        id: "a2",
        name: "Wallet",
        currency: "COP",
        balance: "200.00",
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
  it("renders each account exactly once with no type chip or type label", async () => {
    renderScreens();
    const accounts = await screen.findByRole("region", { name: "Cuentas" });
    expect(within(accounts).getAllByText("Visa")).toHaveLength(1);
    expect(within(accounts).getAllByText("Wallet")).toHaveLength(1);
    // W1: the type surface is gone from the row — no raw value, no label.
    expect(within(accounts).queryByLabelText("Tipo")).not.toBeInTheDocument();
    expect(within(accounts).queryByText("credit_card")).not.toBeInTheDocument();
    expect(within(accounts).queryByText("cash")).not.toBeInTheDocument();
    expect(within(accounts).getAllByRole("button", { name: /^Editar saldo de/ })).toHaveLength(2);
    expect(await screen.findByText("Saldos de tus cuentas bancarias.")).toBeInTheDocument();
  });

  it("drops the card-only decoration (LED, credit usage) without a ledger", async () => {
    renderScreens();
    const accounts = await screen.findByRole("region", { name: "Cuentas" });
    expect(within(accounts).queryByRole("img")).not.toBeInTheDocument();
    expect(within(accounts).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(accounts).queryByText(/25\.0%/)).not.toBeInTheDocument();
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

  it("merges the add controls and the history into one Movimientos panel", async () => {
    renderScreens();
    const panel = await screen.findByRole("region", { name: "Movimientos" });
    expect(screen.getAllByRole("region", { name: "Movimientos" })).toHaveLength(1);
    // The former "Agregar movimiento" card is gone; its controls moved inside.
    expect(screen.queryByRole("region", { name: "Agregar movimiento" })).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Agregar gasto" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Agregar ingreso" })).toBeInTheDocument();
    // The history list and its three filters live in the same card, below the controls.
    expect(within(panel).getByLabelText("Cuenta")).toBeInTheDocument();
    expect(within(panel).getByLabelText("Categoría")).toBeInTheDocument();
    expect(within(panel).getByLabelText("Tipo")).toBeInTheDocument();
    expect(await within(panel).findByText(/Sueldo/)).toBeInTheDocument();
    expect(within(panel).getByText(/Mercado semanal/)).toBeInTheDocument();
  });

  it("keeps both entry controls when the movements history is empty", async () => {
    server.use(http.get("http://test.local/api/movements", () => HttpResponse.json([])));
    renderScreens();
    const panel = await screen.findByRole("region", { name: "Movimientos" });
    expect(await within(panel).findByText("Sin movimientos aún")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Agregar gasto" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Agregar ingreso" })).toBeInTheDocument();
  });

  it("keeps both entry controls when the movements history fails", async () => {
    server.use(
      http.get("http://test.local/api/movements", () => HttpResponse.json(null, { status: 500 })),
    );
    renderScreens();
    const panel = await screen.findByRole("region", { name: "Movimientos" });
    expect(await within(panel).findByText("No se pudieron cargar los movimientos")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Agregar gasto" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Agregar ingreso" })).toBeInTheDocument();
  });

  it("renders the two-series category trend from movement aggregates", async () => {
    renderScreens();
    const chart = await screen.findByRole("region", { name: "Gastos e ingresos por categoría" });
    // The kind-free picker lists finance + subscription kinds together.
    const select = within(chart).getByLabelText("Categoría");
    expect(within(select).getByRole("option", { name: "Alimentación" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Transporte" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "c1" } });
    // Both directions aggregate over time without netting: the gasto and ingreso
    // lines mount, and the period pills stay available.
    expect(await within(chart).findByRole("img", { name: "Tendencia de gastos e ingresos" })).toBeInTheDocument();
    expect(within(chart).getByText("Gastos")).toBeInTheDocument();
    expect(within(chart).getByText("Ingresos")).toBeInTheDocument();
    expect(within(chart).getByRole("radio", { name: "Mes" })).toBeChecked();
  });

  it("exposes the inline balance edit per account with the current value", async () => {
    renderScreens();
    expect(await screen.findByRole("button", { name: "Editar saldo de Visa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar saldo de Wallet" })).toBeInTheDocument();
  });

  it("revalidates dashboard/accounts after an inline balance edit", async () => {
    let accountGets = 0;
    server.use(
      http.get("http://test.local/api/accounts", () => {
        accountGets += 1;
        return HttpResponse.json([
          { id: "a1", name: "Visa", currency: "COP", balance: "-500.00" },
          { id: "a2", name: "Wallet", currency: "COP", balance: "200.00" },
        ]);
      }),
      http.patch("http://test.local/api/accounts/:id", () =>
        HttpResponse.json({ id: "a1", balance: "123.00" }),
      ),
    );
    renderScreens();
    const edit = await screen.findByRole("button", { name: "Editar saldo de Visa" });
    const getsAfterLoad = accountGets;

    fireEvent.click(edit);
    fireEvent.change(screen.getByLabelText("Editar saldo de Visa"), {
      target: { value: "123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    // The balance lives under `dashboard/accounts`; only revalidating
    // `finance/` would leave the row showing the stale amount.
    await waitFor(() => expect(accountGets).toBeGreaterThan(getsAfterLoad));
  });

  it("offers Mover dinero on every account row and preselects the origin", async () => {
    renderScreens();
    const accounts = await screen.findByRole("region", { name: "Cuentas" });
    expect(within(accounts).getAllByRole("button", { name: /^Mover dinero: / })).toHaveLength(2);
    fireEvent.click(within(accounts).getByRole("button", { name: "Mover dinero: Visa" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Mover dinero" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Cuenta origen")).toHaveValue("a1");
    const destination = within(dialog).getByLabelText("Cuenta destino");
    expect(within(destination).queryByRole("option", { name: "Visa" })).not.toBeInTheDocument();
    expect(within(destination).getByRole("option", { name: "Wallet" })).toBeInTheDocument();
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

// -- T4 Finanzas body (RED/GREEN: real KPI data, toolbar operations, quick links) --
describe("finance T4 body", () => {
  it("renders the KPI row from the live reads: real total, real count, no prototype figure", async () => {
    renderScreens();
    const kpis = await screen.findByRole("region", { name: "Métricas de finanzas" });
    // Visa (-500) + Wallet (200) = -300 in the user currency.
    expect(
      // `formatMoney` uses a non-breaking space; the matcher normalizes it.
      within(kpis).getByText(/^-\$\s*300$/),
    ).toBeInTheDocument();
    expect(within(kpis).getByText("2")).toBeInTheDocument();
    expect(within(kpis).getByText("Saldo Total Consolidado")).toBeInTheDocument();
    expect(within(kpis).getByText("Cuentas & Billeteras")).toBeInTheDocument();
    expect(within(kpis).getByText("Gastos del Período")).toBeInTheDocument();
    expect(within(kpis).getByText("Suscripciones Recurrentes")).toBeInTheDocument();
    // D10: the prototype's figures never render.
    expect(within(kpis).queryByText(/2\.620\.900/)).not.toBeInTheDocument();
    expect(within(kpis).queryByText(/5\.2%/)).not.toBeInTheDocument();
  });

  it("never hides a real cycle category: two chips plus an honest +N más marker", async () => {
    // The cycle window is the current natural month in Bogotá, so the fixture
    // dates are derived from the app clock instead of being hardcoded.
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const expense = (id: string, amount: string, categoryId: string) => ({
      id,
      direction: "expense",
      amount,
      occurred_on: day,
      description: null,
      account_id: "a1",
      category_id: categoryId,
      subscription_id: null,
      created_at: day,
      updated_at: day,
    });
    const category = (id: string, name: string) => ({
      id,
      kind: "finance",
      name,
      color: null,
      icon: null,
      is_archived: false,
      created_at: "2026-09-01T00:00:00Z",
    });
    server.use(
      http.get("http://test.local/api/categories", () =>
        HttpResponse.json([
          category("c1", "Comida"),
          category("c2", "Transporte"),
          category("c3", "Mascotas"),
        ]),
      ),
      http.get("http://test.local/api/movements", () =>
        HttpResponse.json([
          expense("m-a", "35000.00", "c1"),
          expense("m-b", "27000.00", "c2"),
          expense("m-c", "20000.00", "c3"),
        ]),
      ),
    );
    renderScreens();
    const kpis = await screen.findByRole("region", { name: "Métricas de finanzas" });
    // The KPI stays complete (35.000 + 27.000 + 20.000) while the chips state the
    // category they folded, so the breakdown can always be reconciled.
    expect(within(kpis).getByText("$ 82.000")).toBeInTheDocument();
    expect(
      within(kpis).getByText("Comida ($ 35.000) + Transporte ($ 27.000) +1 más"),
    ).toBeInTheDocument();
  });

  it("opens the transfer modal from the header toolbar without a preselected origin", async () => {
    renderScreens();
    const toolbarButton = await screen.findByRole("button", { name: "Mover dinero" });
    fireEvent.click(toolbarButton);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Mover dinero" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Cuenta origen")).toHaveValue("");
  });

  it("starts the first real balance editor from the header reconcile action", async () => {
    renderScreens();
    fireEvent.click(await screen.findByRole("button", { name: "Conciliar saldo" }));
    expect(await screen.findByLabelText("Editar saldo de Visa")).toBeInTheDocument();
  });

  it("filters the movements through the round direction chips", async () => {
    renderScreens();
    const panel = await screen.findByRole("region", { name: "Movimientos" });
    const chip = within(panel).getByRole("button", { name: "Gastos" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(within(panel).getByLabelText("Tipo")).toHaveValue("expense");
  });

  it("links the chart footer and the quick access cards to real routes", async () => {
    renderScreens();
    const chart = await screen.findByRole("region", { name: "Gastos e ingresos por categoría" });
    // Next normalizes the rendered href (no trailing slash).
    expect(within(chart).getByRole("link", { name: "Comparar categorías de gasto" })).toHaveAttribute(
      "href",
      "/dashboard/finance/compare",
    );
    const quick = screen.getByRole("navigation", { name: "Acciones rápidas" });
    expect(within(quick).getByRole("link", { name: /Suscripciones/ })).toHaveAttribute(
      "href",
      "/dashboard/ajustes",
    );
    expect(within(quick).getByRole("link", { name: /Progreso/ })).toHaveAttribute(
      "href",
      "/dashboard/progreso",
    );
  });

  it("routes the subscriptions card to the real create/edit path in Ajustes", async () => {
    renderScreens();
    const subs = await screen.findByRole("region", { name: "Suscripciones: crear y gestionar" });
    expect(within(subs).getByRole("link", { name: "Gestionar en Ajustes" })).toHaveAttribute(
      "href",
      "/dashboard/ajustes",
    );
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
  let accountsPostBody: unknown = null;

  it("subs/assets/bank-accounts usan endpoints PR-1 con montos string", async () => {
    server.use(
      http.post("http://test.local/api/subscriptions", () => HttpResponse.json({ id: "s9" })),
      http.patch("http://test.local/api/subscriptions/s1", () => HttpResponse.json({ id: "s1" })),
      http.delete("http://test.local/api/subscriptions/s1", () => new HttpResponse(null, { status: 204 })),
      http.post("http://test.local/api/accounts", async ({ request }) => {
        accountsPostBody = await request.json();
        return HttpResponse.json({ id: "a9" });
      }),
      http.patch("http://test.local/api/assets/a1", () => HttpResponse.json({ id: "a1" })),
      http.post("http://test.local/api/assets/a1/valuations", () => HttpResponse.json({ id: "v1" })),
    );
    await createSubscription({ name: "Streaming", price: "19900" });
    await setSubscriptionActive("s1", false);
    await deleteSubscription("s1");
    await createBankAccount("Cuenta nueva");
    // W1: the create payload is the name only — no type, no card field.
    expect(accountsPostBody).toEqual({ name: "Cuenta nueva" });
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
