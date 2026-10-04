import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import { useRef, useState } from "react";
import { MovementModal, TransferModal } from "@/components/finance/MovementForms";
import { useAccounts } from "@/lib/api/dashboard";
import { useMovements } from "@/lib/api/finance";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const accounts = [{ id: "a1", name: "Cuenta principal" }];
const categories = [{ id: "c1", name: "Mercado" }];

const posted: unknown[] = [];
const transfers: unknown[] = [];
let movementsGets = 0;
let accountGets = 0;

const server = setupServer(
  http.get("http://test.local/api/movements", () => {
    movementsGets += 1;
    return HttpResponse.json([]);
  }),
  http.post("http://test.local/api/movements", async ({ request }) => {
    posted.push(await request.json());
    return HttpResponse.json({ id: "m1" }, { status: 201 });
  }),
  http.post("http://test.local/api/movements/transfer", async ({ request }) => {
    transfers.push(await request.json());
    return HttpResponse.json({ id: "t1", direction: "transfer" }, { status: 201 });
  }),
  http.get("http://test.local/api/accounts", () => {
    accountGets += 1;
    return HttpResponse.json([]);
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  posted.length = 0;
  transfers.length = 0;
  movementsGets = 0;
  accountGets = 0;
});
afterAll(() => server.close());

function MovementsProbe() {
  const { data } = useMovements();
  return <p data-testid="probe">{`movements:${data?.length ?? "?"}`}</p>;
}

function AccountsProbe() {
  const { data } = useAccounts();
  return <p data-testid="accounts-probe">{`accounts:${data?.length ?? "?"}`}</p>;
}

const transferAccounts = [
  { id: "a1", name: "Ahorros", currency: "COP" },
  { id: "a2", name: "Nequi", currency: "COP" },
  { id: "a3", name: "Dólares", currency: "USD" },
];

function TransferHarness({
  initialFromAccountId = "",
  onClose = () => undefined,
}: {
  initialFromAccountId?: string;
  onClose?: () => void;
}) {
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TransferModal
        accounts={transferAccounts}
        initialFromAccountId={initialFromAccountId}
        openerRef={opener}
        onClose={onClose}
      />
      <button ref={opener} type="button">
        opener
      </button>
      <MovementsProbe />
      <AccountsProbe />
    </SWRConfig>
  );
}

function Harness({
  onClose = () => undefined,
}: {
  onClose?: () => void;
}) {
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MovementModal
        mode={{ kind: "create", direction: "expense" }}
        accounts={accounts}
        categories={categories}
        openerRef={opener}
        onClose={onClose}
      />
      <button ref={opener} type="button">
        opener
      </button>
      <MovementsProbe />
    </SWRConfig>
  );
}

describe("MovementModal", () => {
  async function submitAmount(value: string): Promise<string> {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Monto (COP)"), { target: { value } });
    fireEvent.change(screen.getByLabelText("Cuenta"), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    return (posted[0] as Record<string, unknown>).amount as string;
  }

  it("posts 25000,50 without scaling it 100x", async () => {
    expect(await submitAmount("25000,50")).toBe("25000.50");
  });

  it("posts 0,01 without turning it into 1 COP", async () => {
    expect(await submitAmount("0,01")).toBe("0.01");
  });

  it("posts 999999999.99 unscaled (server accepts below 1e9)", async () => {
    expect(await submitAmount("999999999.99")).toBe("999999999.99");
  });

  it("blocks the request with Spanish validation when required fields are missing", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/monto mayor a cero/i);
    expect(posted).toHaveLength(0);
  });

  it("posts the amount as a decimal string and revalidates finance/movements", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Monto (COP)"), { target: { value: "25000" } });
    fireEvent.change(screen.getByLabelText("Cuenta"), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Movimiento guardado.");
    expect(posted).toHaveLength(1);
    const body = posted[0] as Record<string, unknown>;
    expect(body.direction).toBe("expense");
    expect(body.amount).toBe("25000");
    expect(typeof body.amount).toBe("string");
    // Initial read plus the post-save revalidation of the same SWR key.
    await waitFor(() => expect(movementsGets).toBeGreaterThanOrEqual(2));
  });

  it("surfaces the server Spanish message when the API rejects with 422", async () => {
    server.use(
      http.post("http://test.local/api/movements", () =>
        HttpResponse.json(
          { error: { code: "VALIDATION_ERROR", message: "el monto debe ser menor a 1000000000" } },
          { status: 422 },
        ),
      ),
    );
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Monto (COP)"), { target: { value: "25000" } });
    fireEvent.change(screen.getByLabelText("Cuenta"), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "el monto debe ser menor a 1000000000",
    );
  });

  it("falls back to the Spanish save message for a 500 with a non-JSON body", async () => {
    server.use(
      http.post("http://test.local/api/movements", () =>
        HttpResponse.text("Internal Server Error", { status: 500 }),
      ),
    );
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Monto (COP)"), { target: { value: "25000" } });
    fireEvent.change(screen.getByLabelText("Cuenta"), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo guardar. Revisa los datos e inténtalo de nuevo.",
    );
    expect(screen.queryByText("Request failed with status 500")).not.toBeInTheDocument();
  });

  it("falls back to Spanish for a non-Spanish server code (404 NOT_FOUND)", async () => {
    server.use(
      http.post("http://test.local/api/movements", () =>
        HttpResponse.json(
          { error: { code: "NOT_FOUND", message: "Not found" } },
          { status: 404 },
        ),
      ),
    );
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Monto (COP)"), { target: { value: "25000" } });
    fireEvent.change(screen.getByLabelText("Cuenta"), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo guardar. Revisa los datos e inténtalo de nuevo.",
    );
    expect(screen.queryByText("Not found")).not.toBeInTheDocument();
  });

  it("contains Tab and Shift+Tab inside the movement dialog", async () => {
    function TrapHarness() {
      const opener = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(true);
      return (
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          {open ? (
            <MovementModal
              mode={{ kind: "create", direction: "expense" }}
              accounts={accounts}
              categories={categories}
              openerRef={opener}
              onClose={() => setOpen(false)}
            />
          ) : null}
          <button ref={opener} type="button" onClick={() => setOpen(true)}>
            opener
          </button>
        </SWRConfig>
      );
    }
    render(<TrapHarness />);
    const dialog = screen.getByRole("dialog");
    const first = within(dialog).getByLabelText("Tipo de movimiento");
    const last = within(dialog).getByRole("button", { name: "Cancelar" });

    // Initial focus lands inside the dialog (amount field).
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Monto (COP)"));

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "opener" }));
  });

  it("closes on Esc with no request and restores focus to the opener", async () => {
    function EscHarness() {
      const opener = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(true);
      return (
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          {open ? (
            <MovementModal
              mode={{ kind: "create", direction: "income" }}
              accounts={accounts}
              categories={categories}
              openerRef={opener}
              onClose={() => setOpen(false)}
            />
          ) : null}
          <button ref={opener} type="button" onClick={() => setOpen(true)}>
            opener
          </button>
        </SWRConfig>
      );
    }
    render(<EscHarness />);
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
    expect(posted).toHaveLength(0);
  });

  it("deletes with confirmation from edit mode and revalidates", async () => {
    let deleted = 0;
    server.use(
      http.delete("http://test.local/api/movements/m1", () => {
        deleted += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const onClose = vi.fn();
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MovementModal
          mode={{
            kind: "edit",
            movement: {
              id: "m1",
              direction: "expense",
              amount: "25000.00",
              occurred_on: "2026-09-24",
              description: null,
              account_id: "a1",
              category_id: "c1",
              subscription_id: null,
              created_at: "2026-09-24T10:00:00Z",
              updated_at: "2026-09-24T10:00:00Z",
            },
          }}
          accounts={accounts}
          categories={categories}
          onClose={onClose}
        />
      </SWRConfig>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Eliminar" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Movimiento eliminado.");
    expect(deleted).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the edit modal two-directional even for a stored transfer row", () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MovementModal
          mode={{
            kind: "edit",
            movement: {
              id: "t1",
              direction: "transfer",
              amount: "25000.00",
              occurred_on: "2026-10-03",
              description: null,
              account_id: "a1",
              transfer_account_id: "a2",
              category_id: null,
              subscription_id: null,
              created_at: "2026-10-03T10:00:00Z",
              updated_at: "2026-10-03T10:00:00Z",
            },
          }}
          accounts={accounts}
          categories={categories}
          onClose={() => undefined}
        />
      </SWRConfig>,
    );
    const select = screen.getByLabelText("Tipo de movimiento");
    expect(within(select).getAllByRole("option")).toHaveLength(2);
    expect(within(select).queryByRole("option", { name: "Transferencia" })).not.toBeInTheDocument();
  });
});

describe("TransferModal", () => {
  it("preselects the origin and does not offer it as destination", () => {
    render(<TransferHarness initialFromAccountId="a1" />);
    expect(screen.getByRole("heading", { name: "Mover dinero" })).toBeInTheDocument();
    expect(screen.getByLabelText("Cuenta origen")).toHaveValue("a1");
    const destination = screen.getByLabelText("Cuenta destino");
    expect(within(destination).queryByRole("option", { name: "Ahorros" })).not.toBeInTheDocument();
    expect(within(destination).getByRole("option", { name: "Nequi" })).toBeInTheDocument();
  });

  it("clears the destination when the origin switches to the selected account", () => {
    render(<TransferHarness initialFromAccountId="a2" />);
    const destination = screen.getByLabelText("Cuenta destino");
    fireEvent.change(destination, { target: { value: "a1" } });
    expect(destination).toHaveValue("a1");

    const origin = screen.getByLabelText("Cuenta origen");
    fireEvent.change(origin, { target: { value: "a1" } });
    // Changing the origin back restores the option; the stale selection must not.
    fireEvent.change(origin, { target: { value: "a2" } });
    expect(screen.getByLabelText("Cuenta destino")).toHaveValue("");
  });

  it("clears a destination that becomes the origin and blocks the save without a request", async () => {
    render(<TransferHarness />);
    fireEvent.change(screen.getByLabelText("Cuenta destino"), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText("Cuenta origen"), { target: { value: "a1" } });
    // The stale selection is gone by the time the form renders it again.
    expect(screen.getByLabelText("Cuenta destino")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Monto (COP)"), { target: { value: "25000" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Completa los campos marcados.");
    expect(transfers).toHaveLength(0);
  });

  it("blocks a cross-currency selection with Spanish copy and sends nothing", async () => {
    render(<TransferHarness initialFromAccountId="a1" />);
    fireEvent.change(screen.getByLabelText("Cuenta destino"), { target: { value: "a3" } });
    fireEvent.change(screen.getByLabelText("Monto (COP)"), { target: { value: "25000" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ambas cuentas deben usar la misma moneda.",
    );
    expect(transfers).toHaveLength(0);
  });

  it("blocks a missing destination with Spanish copy and sends nothing", async () => {
    render(<TransferHarness initialFromAccountId="a1" />);
    fireEvent.change(screen.getByLabelText("Monto (COP)"), { target: { value: "25000" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Completa los campos marcados.");
    expect(transfers).toHaveLength(0);
  });

  it("posts the transfer contract and revalidates finance/movements and dashboard/accounts", async () => {
    render(<TransferHarness initialFromAccountId="a1" />);
    fireEvent.change(screen.getByLabelText("Cuenta destino"), { target: { value: "a2" } });
    fireEvent.change(screen.getByLabelText("Monto (COP)"), { target: { value: "25000" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Transferencia registrada.");
    expect(transfers).toHaveLength(1);
    const body = transfers[0] as Record<string, unknown>;
    expect(body.from_account_id).toBe("a1");
    expect(body.to_account_id).toBe("a2");
    expect(body.amount).toBe("25000");
    expect(typeof body.amount).toBe("string");
    expect(body.occurred_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await waitFor(() => expect(movementsGets).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(accountGets).toBeGreaterThanOrEqual(2));
  });

  it("contains Tab and Shift+Tab inside the transfer dialog", () => {
    render(<TransferHarness initialFromAccountId="a1" />);
    const dialog = screen.getByRole("dialog");
    const first = within(dialog).getByLabelText("Cuenta origen");
    const last = within(dialog).getByRole("button", { name: "Cancelar" });

    expect(dialog.contains(document.activeElement)).toBe(true);

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("closes on Esc with no request and restores focus to the opener", async () => {
    function EscHarness() {
      const opener = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(true);
      return (
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          {open ? (
            <TransferModal
              accounts={transferAccounts}
              openerRef={opener}
              onClose={() => setOpen(false)}
            />
          ) : null}
          <button ref={opener} type="button" onClick={() => setOpen(true)}>
            opener
          </button>
        </SWRConfig>
      );
    }
    render(<EscHarness />);
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
    expect(transfers).toHaveLength(0);
  });
});
