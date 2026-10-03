import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import { useRef, useState } from "react";
import { MovementModal } from "@/components/finance/MovementForms";
import { useMovements } from "@/lib/api/finance";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const accounts = [{ id: "a1", name: "Cuenta principal" }];
const categories = [{ id: "c1", name: "Mercado" }];

const posted: unknown[] = [];
let movementsGets = 0;

const server = setupServer(
  http.get("http://test.local/api/movements", () => {
    movementsGets += 1;
    return HttpResponse.json([]);
  }),
  http.post("http://test.local/api/movements", async ({ request }) => {
    posted.push(await request.json());
    return HttpResponse.json({ id: "m1" }, { status: 201 });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  posted.length = 0;
  movementsGets = 0;
});
afterAll(() => server.close());

function MovementsProbe() {
  const { data } = useMovements();
  return <p data-testid="probe">{`movements:${data?.length ?? "?"}`}</p>;
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
});
