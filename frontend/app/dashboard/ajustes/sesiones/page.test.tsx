import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard/ajustes/sesiones/",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    h("a", { href, ...rest }, children),
}));

import SessionsPage from "./page";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

interface Row {
  id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  user_agent: string | null;
  ip_address: string | null;
  current: boolean;
}

let rows: Row[] = seedRows();
let getMode: "ok" | "empty" | "fail-once" = "ok";
let getCalls = 0;
let deleteCalls = 0;

function seedRows(): Row[] {
  return [
    {
      id: "11111111-1111-1111-1111-111111111111",
      created_at: "2026-10-01T10:00:00Z",
      expires_at: "2026-10-02T10:00:00Z",
      revoked_at: null,
      user_agent: "Mozilla/5.0 (X11; Linux x86_64)",
      ip_address: "192.0.2.7",
      current: true,
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      created_at: "2026-09-30T08:00:00Z",
      expires_at: "2026-10-01T08:00:00Z",
      revoked_at: null,
      user_agent: "Safari/605",
      ip_address: "198.51.100.4",
      current: false,
    },
  ];
}

const server = setupServer(
  http.get("http://test.local/api/sessions", () => {
    getCalls += 1;
    if (getMode === "fail-once" && getCalls === 1) {
      return HttpResponse.json({ code: "INTERNAL", message: "boom" }, { status: 500 });
    }
    return HttpResponse.json(getMode === "empty" ? [] : rows);
  }),
  http.delete("http://test.local/api/sessions", () => {
    deleteCalls += 1;
    rows = rows.filter((row) => row.current);
    return new HttpResponse(null, { status: 204 });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  rows = seedRows();
  getMode = "ok";
  getCalls = 0;
  deleteCalls = 0;
  vi.restoreAllMocks();
});
afterAll(() => server.close());

describe("sessions page", () => {
  it("lists every session, marks exactly one as current and never shows a hash", async () => {
    render(h(SessionsPage, null));
    expect(await screen.findByText("Mozilla/5.0 (X11; Linux x86_64)")).toBeInTheDocument();
    expect(screen.getByText("Safari/605")).toBeInTheDocument();
    expect(screen.getAllByText("Actual")).toHaveLength(1);
    expect(screen.getByText("192.0.2.7")).toBeInTheDocument();
    expect(screen.getByText("198.51.100.4")).toBeInTheDocument();
    expect(screen.getAllByText("Expira:")).toHaveLength(2);
    expect(screen.queryByText(/token_hash/i)).not.toBeInTheDocument();
  });

  it("marks the sessions entry current in the sidebar chrome", async () => {
    render(h(SessionsPage, null));
    expect(await screen.findByText("Safari/605")).toBeInTheDocument();

    const links = screen.getAllByRole("link", { name: "Sesiones" });
    expect(links.some((link) => link.getAttribute("aria-current") === "page")).toBe(true);
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  });

  it("asks for confirmation and closes every other session", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(h(SessionsPage, null));
    expect(await screen.findByText("Safari/605")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar otras sesiones" }));
    expect(confirm).toHaveBeenCalledWith(
      "¿Cerrar todas las otras sesiones? Tendrás que iniciar sesión de nuevo en esos dispositivos.",
    );
    expect(await screen.findByText("Sesiones cerradas.")).toBeInTheDocument();
    expect(deleteCalls).toBe(1);
    await waitFor(() => expect(screen.queryByText("Safari/605")).not.toBeInTheDocument());
    expect(screen.getByText("Mozilla/5.0 (X11; Linux x86_64)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar otras sesiones" })).toBeDisabled();
  });

  it("skips the revoke when the confirmation is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(h(SessionsPage, null));
    expect(await screen.findByText("Safari/605")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar otras sesiones" }));
    await waitFor(() => expect(screen.queryByText("Sesiones cerradas.")).not.toBeInTheDocument());
    expect(deleteCalls).toBe(0);
    expect(
      within(screen.getByRole("list")).getByText("Safari/605"),
    ).toBeInTheDocument();
  });

  it("shows the empty state when there are no sessions", async () => {
    getMode = "empty";
    render(h(SessionsPage, null));
    expect(await screen.findByText("Sin sesiones registradas")).toBeInTheDocument();
  });

  it("shows the error state with retry", async () => {
    getMode = "fail-once";
    render(h(SessionsPage, null));
    expect(await screen.findByText("No se pudieron cargar las sesiones")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Safari/605")).toBeInTheDocument();
  });

  it("surfaces a revoke failure without losing the list", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    server.use(
      http.delete("http://test.local/api/sessions", () =>
        HttpResponse.json({ code: "INTERNAL", message: "boom" }, { status: 500 }),
      ),
    );
    render(h(SessionsPage, null));
    expect(await screen.findByText("Safari/605")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar otras sesiones" }));
    expect(
      await screen.findByText("No se pudieron cerrar las sesiones. Inténtalo de nuevo."),
    ).toBeInTheDocument();
    expect(screen.getByText("Safari/605")).toBeInTheDocument();
  });
});
