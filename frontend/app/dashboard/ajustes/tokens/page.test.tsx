import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard/ajustes/tokens/",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    h("a", { href, ...rest }, children),
}));

import TokensPage from "./page";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

interface Row {
  id: string;
  name: string;
  prefix: string;
  scopes: unknown[];
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

let rows: Row[] = seedRows();
let getMode: "ok" | "empty" | "fail-once" = "ok";
let getCalls = 0;
const seenPosts: unknown[] = [];
const seenDeletes: string[] = [];

function seedRows(): Row[] {
  return [
    {
      id: "11111111-1111-1111-1111-111111111111",
      name: "cli",
      prefix: "pd_Ab12Cd",
      scopes: [],
      expires_at: null,
      last_used_at: null,
      revoked_at: null,
      created_at: "2026-09-18T00:00:00Z",
    },
  ];
}

const server = setupServer(
  http.get("http://test.local/api/tokens", () => {
    getCalls += 1;
    if (getMode === "fail-once" && getCalls === 1) {
      return HttpResponse.json({ code: "INTERNAL", message: "boom" }, { status: 500 });
    }
    return HttpResponse.json(getMode === "empty" ? [] : rows);
  }),
  http.post("http://test.local/api/tokens", async ({ request }) => {
    const body = (await request.json()) as { name: string; expires_in_days?: number };
    seenPosts.push(body);
    const created: Row = {
      id: "22222222-2222-2222-2222-222222222222",
      name: body.name,
      prefix: "pd_NeWtok",
      scopes: [],
      expires_at: body.expires_in_days ? "2026-10-18T00:00:00Z" : null,
      last_used_at: null,
      revoked_at: null,
      created_at: "2026-09-18T00:00:00Z",
    };
    rows = [created, ...rows];
    return HttpResponse.json(
      {
        id: created.id,
        name: created.name,
        token: "pd_rawSecretOnlyOnce",
        prefix: created.prefix,
        expires_at: created.expires_at,
      },
      { status: 201 },
    );
  }),
  http.delete("http://test.local/api/tokens/:id", ({ params }) => {
    seenDeletes.push(params.id as string);
    rows = rows.map((r) =>
      r.id === params.id ? { ...r, revoked_at: "2026-09-18T12:00:00Z" } : r,
    );
    const revoked = rows.find((r) => r.id === params.id);
    return HttpResponse.json(revoked);
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  rows = seedRows();
  getMode = "ok";
  getCalls = 0;
  seenPosts.length = 0;
  seenDeletes.length = 0;
  vi.restoreAllMocks();
});
afterAll(() => server.close());

describe("tokens page", () => {
  it("lists tokens with name, prefix and status", async () => {
    render(h(TokensPage, null));
    expect(screen.getByText("Cargando tokens…")).toBeInTheDocument();
    expect(await screen.findByText("cli")).toBeInTheDocument();
    expect(screen.getByText("pd_Ab12Cd")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
  });

  it("marks the tokens entry current in the sidebar chrome", async () => {
    render(h(TokensPage, null));
    expect(await screen.findByText("cli")).toBeInTheDocument();

    const tokensLinks = screen.getAllByRole("link", { name: "Tokens" });
    expect(tokensLinks.some((l) => l.getAttribute("aria-current") === "page")).toBe(true);
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  });

  it("shows the empty state when there are no tokens", async () => {
    getMode = "empty";
    render(h(TokensPage, null));
    expect(await screen.findByText("Sin tokens aún")).toBeInTheDocument();
    expect(screen.getByText("Crea tu primer token para automatizar accesos.")).toBeInTheDocument();
  });

  it("shows the error state with retry", async () => {
    getMode = "fail-once";
    render(h(TokensPage, null));
    expect(await screen.findByText("No se pudieron cargar los tokens")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("cli")).toBeInTheDocument();
  });

  it("rejects an empty name without calling the api", async () => {
    render(h(TokensPage, null));
    expect(await screen.findByText("cli")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Crear token", hidden: false }));
    // The submit button inside the form (exact accessible name disambiguates
    // it from the section heading).
    expect(await screen.findByText("Escribe un nombre de 1 a 80 caracteres.")).toBeInTheDocument();
    expect(seenPosts).toHaveLength(0);
  });

  it("creates a token and shows the raw secret once with copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(h(TokensPage, null));
    expect(await screen.findByText("cli")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Ej. CLI personal"), {
      target: { value: "automatización" },
    });
    fireEvent.change(screen.getByLabelText("Expiración"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear token" }));

    expect(await screen.findByText("Token creado")).toBeInTheDocument();
    expect(screen.getByText("pd_rawSecretOnlyOnce")).toBeInTheDocument();
    expect(
      screen.getByText("Copia este token ahora. No se mostrará más."),
    ).toBeInTheDocument();
    expect(seenPosts).toEqual([{ name: "automatización", expires_in_days: 30 }]);
    // The new token joins the list (refresh) while the raw stays visible once.
    expect(await screen.findByText("automatización")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copiar" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("pd_rawSecretOnlyOnce"));
    expect(await screen.findByText("¡Copiado!")).toBeInTheDocument();
  });

  it("asks for confirmation before revoking and refreshes the list", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(h(TokensPage, null));
    expect(await screen.findByText("cli")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Eliminar: cli" }));
    expect(confirm).toHaveBeenCalledWith(
      "¿Eliminar el token cli? Esta acción no se puede deshacer.",
    );
    expect(await screen.findByText("Revocado")).toBeInTheDocument();
    expect(seenDeletes).toEqual(["11111111-1111-1111-1111-111111111111"]);
  });

  it("skips the revoke when the confirmation is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(h(TokensPage, null));
    expect(await screen.findByText("cli")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Eliminar: cli" }));
    await waitFor(() =>
      expect(screen.queryByText("Revocado")).not.toBeInTheDocument(),
    );
    expect(seenDeletes).toHaveLength(0);
    // List item still present and active.
    expect(within(screen.getByRole("list")).getByText("cli")).toBeInTheDocument();
  });
});
