import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CategoryWire } from "@/lib/api/finance";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard/ajustes/",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    h("a", { href, ...rest }, children),
}));

import AjustesPage from "./page";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

/** In-memory categories store backing the stateful MSW handlers. MSW v2
 * matches handlers by pathname only (`getCleanUrl` drops the query string),
 * so the same handler serves both the section's `?kind=finance` read and
 * the kind-free read; it honors `kind` when present. */
const categories: CategoryWire[] = [];
let categorySeq = 0;

function categoryRow(id: string, name: string, kind = "finance"): CategoryWire {
  return {
    id,
    kind,
    name,
    color: null,
    icon: null,
    is_archived: false,
    created_at: "2026-01-01",
  };
}

const server = setupServer(
  http.get("http://test.local/api/accounts", () => {
    return HttpResponse.json([
      { id: "a1", name: "Principal", currency: "COP", balance: "100.00" },
      { id: "a2", name: "Visa", currency: "COP", balance: "-10.00" },
    ]);
  }),
  http.post("http://test.local/api/accounts", () => HttpResponse.json({ id: "a9" })),
  http.delete("http://test.local/api/accounts/:id", () => new HttpResponse(null, { status: 204 })),
  http.get("http://test.local/api/categories", ({ request }) => {
    const kind = new URL(request.url).searchParams.get("kind");
    const rows = kind ? categories.filter((row) => row.kind === kind) : categories;
    return HttpResponse.json(rows);
  }),
  // Subscriptions are read by the Suscripciones section; with no rows it
  // renders the create form, which owns the category picker under test.
  http.get("http://test.local/api/subscriptions", () => HttpResponse.json([])),
  http.post("http://test.local/api/categories", async ({ request }) => {
    const body = (await request.json()) as { name: string; kind?: string };
    const row = categoryRow(`c-${++categorySeq}`, body.name, body.kind ?? "finance");
    categories.push(row);
    return HttpResponse.json(row, { status: 201 });
  }),
  http.delete("http://test.local/api/categories/:id", ({ params }) => {
    const index = categories.findIndex((row) => row.id === params.id);
    if (index >= 0) categories.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
  categories.length = 0;
  categorySeq = 0;
});
afterAll(() => server.close());

function renderPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AjustesPage />
    </SWRConfig>,
  );
}

describe("ajustes page", () => {
  it("lists every non-archived account and creates one by alias", async () => {
    window.confirm = vi.fn(() => true);
    renderPage();
    // W1: the type filter is gone, so the section manages every account.
    const section = await screen.findByRole("region", { name: "Cuentas" });
    expect(within(section).getByText("Principal")).toBeInTheDocument();
    expect(within(section).getByText("Visa")).toBeInTheDocument();
    expect(within(section).queryByLabelText("Tipo")).not.toBeInTheDocument();
    fireEvent.change(within(section).getByLabelText("Nombre o alias"), {
      target: { value: "Ahorros" },
    });
    fireEvent.click(within(section).getByRole("button", { name: "Agregar cuenta" }));
    await within(section).findByDisplayValue("");
    expect((within(section).getByLabelText("Nombre o alias") as HTMLInputElement).value).toBe("");
  });

  it("creates name-only categories with no kind control and deletes them", async () => {
    window.confirm = vi.fn(() => true);
    renderPage();
    const section = await screen.findByRole("region", { name: "Categorías" });
    expect(within(section).getByText("Sin categorías aún")).toBeInTheDocument();
    expect(within(section).queryByLabelText("Tipo")).not.toBeInTheDocument();
    fireEvent.change(within(section).getByLabelText("Nombre"), { target: { value: "Comida" } });
    fireEvent.click(within(section).getByRole("button", { name: "Crear categoría" }));
    expect(await within(section).findByText("Comida")).toBeInTheDocument();
    expect(within(section).queryByText("Gasto")).not.toBeInTheDocument();
    expect(within(section).queryByText("Ingreso")).not.toBeInTheDocument();
    fireEvent.click(within(section).getByRole("button", { name: "Eliminar: Comida" }));
    await waitFor(() => expect(within(section).queryByText("Comida")).not.toBeInTheDocument());
  });

  it("offers only finance categories in the subscriptions create picker", async () => {
    // Both rows are served by the same category store; the unfiltered read
    // offers them all, the finance-filtered read only `Comida`. A habit
    // category in this picker is the C4-adjacent defect this test pins.
    categories.push(
      categoryRow("c-fin", "Comida"),
      categoryRow("c-habit", "Salud", "habit"),
    );
    renderPage();

    const section = await screen.findByRole("region", { name: "Suscripciones" });
    const picker = await within(section).findByLabelText("Categoría");
    await waitFor(() => expect(picker.querySelector("option[value=c-fin]")).not.toBeNull());
    expect(picker.querySelector("option[value=c-habit]")).toBeNull();
  });

  it("shows an error with retry when the accounts fetch fails", async () => {
    server.use(http.get("http://test.local/api/accounts", () => HttpResponse.error()));
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <AjustesPage />
      </SWRConfig>,
    );
    const section = await screen.findByRole("region", { name: "Cuentas" });
    expect(await within(section).findByRole("alert")).toHaveTextContent("No se pudo cargar esta sección");
    expect(within(section).getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("links to the session management page", () => {
    renderPage();
    const link = screen.getByRole("link", { name: /Sesiones activas/ });
    expect(link).toHaveAttribute("href", "/dashboard/ajustes/sesiones/");
  });

  // Both settings children leave the five-item mobile tab bar, so the hub has to
  // keep them reachable in-page.
  it("keeps tokens and sessions one tap away for the mobile tab bar", () => {
    renderPage();
    const tokens = screen
      .getAllByRole("link", { name: /Tokens de API/ })
      .find((link) => link.getAttribute("href") === "/dashboard/ajustes/tokens/");
    expect(tokens).toBeDefined();
    const sessions = screen
      .getAllByRole("link", { name: /Sesiones activas/ })
      .find((link) => link.getAttribute("href") === "/dashboard/ajustes/sesiones/");
    expect(sessions).toBeDefined();
  });
});
