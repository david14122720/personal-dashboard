import { createElement as h } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

const server = setupServer(
  http.get("http://test.local/api/accounts", () => {
    return HttpResponse.json([
      { id: "a1", name: "Principal", type: "bank", currency: "COP", balance: "100.00" },
      { id: "a2", name: "Visa", type: "credit_card", currency: "COP", balance: "-10.00" },
    ]);
  }),
  http.post("http://test.local/api/accounts", () => HttpResponse.json({ id: "a9" })),
  http.delete("http://test.local/api/accounts/:id", () => new HttpResponse(null, { status: 204 })),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
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
  it("lists bank accounts and creates one by alias", async () => {
    window.confirm = vi.fn(() => true);
    renderPage();
    const section = await screen.findByRole("region", { name: "Cuentas bancarias" });
    expect(within(section).getByText("Principal")).toBeInTheDocument();
    expect(within(section).queryByText("Visa")).not.toBeInTheDocument();
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
    expect(within(section).queryByText("Comida")).not.toBeInTheDocument();
  });

  it("shows an error with retry when the accounts fetch fails", async () => {
    server.use(http.get("http://test.local/api/accounts", () => HttpResponse.error()));
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <AjustesPage />
      </SWRConfig>,
    );
    const section = await screen.findByRole("region", { name: "Cuentas bancarias" });
    expect(await within(section).findByRole("alert")).toHaveTextContent("No se pudo cargar esta sección");
    expect(within(section).getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});
