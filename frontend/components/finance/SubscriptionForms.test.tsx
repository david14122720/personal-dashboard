import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import { SubscriptionRow } from "@/components/finance/SubscriptionForms";
import { useMovementsRange, type SubscriptionWire } from "@/lib/api/finance";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

function sub(id: string, overrides: Partial<SubscriptionWire> = {}): SubscriptionWire {
  return {
    id,
    name: `Sub ${id}`,
    price: "19900.00",
    currency: "COP",
    frequency: "monthly",
    next_billing_on: "2026-10-15",
    is_active: true,
    last_paid_on: null,
    ...overrides,
  };
}

const payBodies: unknown[] = [];
const patched: { id: string; body: unknown }[] = [];
let deleted: string[] = [];
let payStatus = 200;
/** Query strings of the ranged reads: paying a subscription mints a movement, so
 * the period panels' `finance/movements:<from>:<to>` keys must be revalidated
 * too (verifier finding F1). */
const rangedGets: string[] = [];

const server = setupServer(
  http.get("http://test.local/api/accounts", () =>
    HttpResponse.json([
      { id: "a1", name: "Cuenta principal", type: "bank", currency: "COP", balance: "100000.00" },
    ]),
  ),
  http.get("http://test.local/api/movements", ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.has("from")) rangedGets.push(url.search);
    return HttpResponse.json([]);
  }),
  http.get("http://test.local/api/subscriptions", () => HttpResponse.json([])),
  http.post("http://test.local/api/subscriptions/:id/pay", async ({ request }) => {
    payBodies.push(await request.json());
    if (payStatus !== 200) {
      return HttpResponse.json(
        { code: "finance.subscriptionPaidThisCycle", message: "Ya pagada" },
        { status: payStatus },
      );
    }
    return HttpResponse.json(sub("s1", { last_paid_on: "2026-09-24" }));
  }),
  http.patch("http://test.local/api/subscriptions/:id", async ({ params, request }) => {
    patched.push({ id: String(params.id), body: await request.json() });
    return HttpResponse.json(sub(String(params.id)));
  }),
  http.delete("http://test.local/api/subscriptions/:id", ({ params }) => {
    deleted.push(String(params.id));
    return new HttpResponse(null, { status: 204 });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  payBodies.length = 0;
  patched.length = 0;
  deleted = [];
  payStatus = 200;
  rangedGets.length = 0;
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function Harness({ row }: { row: SubscriptionWire }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <SubscriptionRow sub={row} />
    </SWRConfig>
  );
}

/** Ranged read probe: stands in for the period panels' `finance/movements:<from>:<to>` key. */
function RangedProbe() {
  const { data } = useMovementsRange({ from: "2026-10-01", to: "2026-10-31" });
  return <p data-testid="ranged-probe">{`ranged:${data?.length ?? "?"}`}</p>;
}

function RangedHarness({ row }: { row: SubscriptionWire }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <SubscriptionRow sub={row} />
      <RangedProbe />
    </SWRConfig>
  );
}

describe("SubscriptionRow pay flow", () => {
  it("shows COP price, due date and paid state with no frequency label", () => {
    render(
      <Harness
        row={sub("s1", { name: "Streaming", last_paid_on: "2026-09-24", next_billing_on: "2099-01-15" })}
      />,
    );
    expect(screen.getByText("Streaming")).toBeDefined();
    expect(screen.getByText(/15 de ene de 2099/)).toBeDefined();
    // The raw ISO date is not what the user reads (Bogotá format instead).
    expect(screen.queryByText(/2099-01-15/)).toBeNull();
    expect(screen.getByText("Pagado este ciclo")).toBeDefined();
    // Paid rows offer no Pay control.
    expect(screen.queryByRole("button", { name: "Pagar" })).toBeNull();
  });

  it("pay modal sends only {account_id} to the pay endpoint", async () => {
    render(<Harness row={sub("s1", { name: "Streaming" })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Pagar" }));
    await screen.findByRole("dialog", { name: "Pagar suscripción" });

    await waitFor(() =>
      expect(screen.getByLabelText("Elige una cuenta").querySelector("option[value=a1]")).not.toBeNull(),
    );
    fireEvent.change(screen.getByLabelText("Elige una cuenta"), { target: { value: "a1" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));

    await waitFor(() => expect(payBodies).toHaveLength(1));
    expect(payBodies[0]).toEqual({ account_id: "a1" });
  });

  it("offers only accounts in the subscription's currency (F-05 residual)", async () => {
    server.use(
      http.get("http://test.local/api/accounts", () =>
        HttpResponse.json([
          { id: "a1", name: "Cuenta COP", type: "bank", currency: "COP", balance: "1.00" },
          { id: "a2", name: "Cuenta USD", type: "bank", currency: "USD", balance: "1.00" },
        ]),
      ),
    );
    render(<Harness row={sub("s1", { name: "Streaming", currency: "COP" })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Pagar" }));
    await screen.findByRole("dialog", { name: "Pagar suscripción" });

    const picker = screen.getByLabelText("Elige una cuenta");
    await waitFor(() => expect(picker.querySelector("option[value=a1]")).not.toBeNull());
    // A cross-currency pay is a 422 on the server, so the picker must not
    // offer it in the first place (the backend guard is the second barrier).
    expect(picker.querySelector("option[value=a2]")).toBeNull();
  });

  it("explains the currency rule when no account can pay the row", async () => {
    server.use(
      http.get("http://test.local/api/accounts", () =>
        HttpResponse.json([
          { id: "a2", name: "Cuenta USD", type: "bank", currency: "USD", balance: "1.00" },
        ]),
      ),
    );
    render(<Harness row={sub("s1", { name: "Streaming", currency: "COP" })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Pagar" }));
    await screen.findByRole("dialog", { name: "Pagar suscripción" });

    await waitFor(() =>
      expect(
        screen.getByText("Necesitás una cuenta en COP para pagar esta suscripción."),
      ).toBeDefined(),
    );
  });

  it("tras pagar, revalida también la lectura con rango (F1)", async () => {
    render(<RangedHarness row={sub("s1", { name: "Streaming" })} />);
    // The ranged key is already in the cache before the payment.
    await waitFor(() => expect(rangedGets).toHaveLength(1));

    fireEvent.click(await screen.findByRole("button", { name: "Pagar" }));
    await screen.findByRole("dialog", { name: "Pagar suscripción" });
    await waitFor(() =>
      expect(screen.getByLabelText("Elige una cuenta").querySelector("option[value=a1]")).not.toBeNull(),
    );
    fireEvent.change(screen.getByLabelText("Elige una cuenta"), { target: { value: "a1" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));
    await waitFor(() => expect(payBodies).toHaveLength(1));

    // Paying mints a movement: an exact-key mutate leaves the period panels stale.
    await waitFor(() => expect(rangedGets).toHaveLength(2));
  });

  it("surfaces the Spanish double-pay message on 409", async () => {
    payStatus = 409;
    render(<Harness row={sub("s1")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Pagar" }));
    await screen.findByRole("dialog", { name: "Pagar suscripción" });

    await waitFor(() =>
      expect(screen.getByLabelText("Elige una cuenta").querySelector("option[value=a1]")).not.toBeNull(),
    );
    fireEvent.change(screen.getByLabelText("Elige una cuenta"), { target: { value: "a1" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/ya está pagada este ciclo/i);
    expect(payBodies).toHaveLength(1);
  });

  it("hides Pay for free rows and names the free-tier rule", () => {
    render(<Harness row={sub("s1", { price: "0.00" })} />);
    expect(screen.queryByRole("button", { name: "Pagar" })).toBeNull();
    expect(screen.getByText("Las suscripciones gratuitas no requieren pago.")).toBeDefined();
  });

  it("cancels through the widened PATCH with {is_active:false}", async () => {
    render(<Harness row={sub("s1")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]).toEqual({ id: "s1", body: { is_active: false } });
  });

  it("reactivates through the widened PATCH with {is_active:true}", async () => {
    render(<Harness row={sub("s1", { is_active: false })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reactivar" }));
    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]).toEqual({ id: "s1", body: { is_active: true } });
  });

  it("deletes with explicit confirmation and removes the row", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Harness row={sub("s1", { name: "Streaming" })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Eliminar" }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(deleted).toEqual(["s1"]));
  });

  it("does not delete when the confirmation is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Harness row={sub("s1", { name: "Streaming" })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(screen.getByText("Streaming")).toBeDefined());
    expect(deleted).toEqual([]);
  });

  it("surfaces the pay guard's Spanish 422 message (F11.4)", async () => {
    server.use(
      http.post("http://test.local/api/subscriptions/:id/pay", () =>
        HttpResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message:
                "el precio de la suscripcion supera el maximo permitido; editalo antes de pagar",
            },
          },
          { status: 422 },
        ),
      ),
    );
    render(<Harness row={sub("s1")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Pagar" }));
    await screen.findByRole("dialog", { name: "Pagar suscripción" });

    await waitFor(() =>
      expect(screen.getByLabelText("Elige una cuenta").querySelector("option[value=a1]")).not.toBeNull(),
    );
    fireEvent.change(screen.getByLabelText("Elige una cuenta"), { target: { value: "a1" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "el precio de la suscripcion supera el maximo permitido; editalo antes de pagar",
    );
  });
});
