import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import SubscriptionsSection from "@/components/settings/SubscriptionsSection";
import type { SubscriptionWire } from "@/lib/api/finance";

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
    payment_method: null,
    category_id: null,
    last_paid_on: null,
    ...overrides,
  };
}

let subs: SubscriptionWire[] = [];
const categories = [
  { id: "c1", kind: "finance", name: "Mercado", color: null, icon: null, is_archived: false, created_at: "2026-01-01" },
];
const posted: unknown[] = [];
const patched: { id: string; body: unknown }[] = [];

const server = setupServer(
  http.get("http://test.local/api/subscriptions", () => HttpResponse.json(subs)),
  http.get("http://test.local/api/categories", () => HttpResponse.json(categories)),
  http.post("http://test.local/api/subscriptions", async ({ request }) => {
    posted.push(await request.json());
    return HttpResponse.json(sub("new"), { status: 201 });
  }),
  http.patch("http://test.local/api/subscriptions/:id", async ({ params, request }) => {
    patched.push({ id: String(params.id), body: await request.json() });
    return HttpResponse.json(sub(String(params.id)));
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  subs = [];
  posted.length = 0;
  patched.length = 0;
});
afterAll(() => server.close());

function Harness() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <SubscriptionsSection />
    </SWRConfig>
  );
}

describe("SubscriptionsSection", () => {
  it("creates with a monthly payload and no frequency field", async () => {
    subs = [];
    render(<Harness />);
    await screen.findByRole("form", { name: "Crear suscripción" });

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Streaming" } });
    fireEvent.change(screen.getByLabelText("Precio"), { target: { value: "19900" } });
    fireEvent.change(screen.getByLabelText("Próximo cobro"), { target: { value: "2026-10-15" } });
    await waitFor(() =>
      expect(screen.getByLabelText("Categoría").querySelector("option[value=c1]")).not.toBeNull(),
    );
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("Método de pago"), { target: { value: "transferencia" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear suscripción" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    const body = posted[0] as Record<string, unknown>;
    expect(body.name).toBe("Streaming");
    expect(body.price).toBe("19900");
    expect(typeof body.price).toBe("string");
    expect(body.next_billing_on).toBe("2026-10-15");
    expect(body.category_id).toBe("c1");
    expect(body.payment_method).toBe("transferencia");
    expect(body).not.toHaveProperty("frequency");
  });

  it("blocks an invalid price with a Spanish error and sends no request", async () => {
    subs = [];
    render(<Harness />);
    await screen.findByRole("form", { name: "Crear suscripción" });

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Streaming" } });
    fireEvent.change(screen.getByLabelText("Precio"), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("Próximo cobro"), { target: { value: "2026-10-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear suscripción" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/mayor a cero/i);
    expect(posted).toHaveLength(0);
  });

  it("requires the monthly due date with a Spanish error and sends no request", async () => {
    subs = [];
    render(<Harness />);
    await screen.findByRole("form", { name: "Crear suscripción" });

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Streaming" } });
    fireEvent.change(screen.getByLabelText("Precio"), { target: { value: "19900" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear suscripción" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/próximo cobro mensual/i);
    expect(posted).toHaveLength(0);
  });

  it("renders no frequency control — monthly is copy, not a choice", async () => {
    subs = [sub("s1")];
    render(<Harness />);
    await screen.findByText("Sub s1");
    expect(screen.queryByLabelText("Frecuencia")).toBeNull();
    expect(screen.getByText("Mensual fijo")).toBeDefined();
  });

  it("edits through the widened PATCH allowlist only", async () => {
    subs = [sub("s1", { name: "Streaming", price: "19900.00", next_billing_on: "2026-10-15" })];
    render(<Harness />);
    await screen.findByText("Streaming");

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    const form = await screen.findByRole("form", { name: "Editar" });
    fireEvent.change(within(form).getByLabelText("Precio"), { target: { value: "29900" } });
    fireEvent.change(within(form).getByLabelText("Próximo cobro"), { target: { value: "2026-11-15" } });
    fireEvent.click(within(form).getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].id).toBe("s1");
    const body = patched[0].body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["name", "next_billing_on", "price"]);
    expect(body.price).toBe("29900");
    expect(body.next_billing_on).toBe("2026-11-15");
  });
});
