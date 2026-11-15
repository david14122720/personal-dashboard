import { createElement as h } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

import ApiTokensPanel from "@/components/settings/ApiTokensPanel";
import { setToken } from "@/lib/api/client";

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

function row(id: string, name: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    name,
    prefix: "pd_Ab12Cd",
    scopes: [],
    expires_at: "2026-10-18T00:00:00Z",
    last_used_at: null,
    revoked_at: null,
    created_at: "2026-09-18T00:00:00Z",
    ...overrides,
  };
}

let rows: Row[] = [];
let revokeAllCalls = 0;
let revokeAllFailure = false;

const server = setupServer(
  http.get("http://test.local/api/tokens", () => HttpResponse.json(rows)),
  http.delete("http://test.local/api/tokens", () => {
    revokeAllCalls += 1;
    if (revokeAllFailure) {
      return HttpResponse.json({ code: "INTERNAL", message: "boom" }, { status: 500 });
    }
    // F-13 revoke-all: every live row is closed, and the count is what the call
    // reports (a repeat answers 0, the statement only matches live rows).
    const live = rows.filter((r) => r.revoked_at === null).length;
    rows = rows.map((r) =>
      r.revoked_at === null ? { ...r, revoked_at: "2026-09-19T00:00:00Z" } : r,
    );
    return HttpResponse.json({ revoked: live });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  document.title = "";
  localStorage.clear();
  rows = [row("11111111-1111-1111-1111-111111111111", "cli"), row("22222222-2222-2222-2222-222222222222", "sync")];
  revokeAllCalls = 0;
  revokeAllFailure = false;
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function renderPanel() {
  setToken("session-123");
  return render(h(ApiTokensPanel, null));
}

describe("ApiTokensPanel revoke-all (F-13)", () => {
  it("closes every token after one confirmation and reports the count", async () => {
    rows = [row("11111111-1111-1111-1111-111111111111", "cli"), row("22222222-2222-2222-2222-222222222222", "sync")];
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPanel();
    expect(await screen.findByText("cli")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revocar todos" }));

    expect(confirm).toHaveBeenCalledWith(
      "¿Revocar todos tus tokens? Las automatizaciones que los usan dejarán de funcionar.",
    );
    expect(await screen.findByText("2 token(s) revocados.")).toBeInTheDocument();
    expect(revokeAllCalls).toBe(1);
    // The list is re-read, so both rows now report the revoked state.
    expect(await screen.findAllByText("Revocado")).toHaveLength(2);
    // Nothing live is left: the control is not offered again.
    expect(screen.getByRole("button", { name: "Revocar todos" })).toBeDisabled();
  });

  it("does nothing when the confirmation is dismissed", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPanel();
    expect(await screen.findByText("cli")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revocar todos" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(revokeAllCalls).toBe(0);
    expect(screen.queryByText(/token\(s\) revocados/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revocar todos" })).toBeEnabled();
  });

  it("surfaces a failed revoke-all without touching the list", async () => {
    revokeAllFailure = true;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPanel();
    expect(await screen.findByText("cli")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revocar todos" }));

    expect(
      await screen.findByText("No se pudieron revocar los tokens. Inténtalo de nuevo."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/token\(s\) revocados/)).not.toBeInTheDocument();
    expect(screen.queryByText("Revocado")).not.toBeInTheDocument();
  });

  it("is unavailable when every listed token is already revoked", async () => {
    rows = [
      row("11111111-1111-1111-1111-111111111111", "cli", {
        revoked_at: "2026-09-19T00:00:00Z",
      }),
    ];
    renderPanel();
    expect(await screen.findByText("cli")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revocar todos" })).toBeDisabled();
  });

  it("never offers a lifetime above the 180-day cap", async () => {
    renderPanel();
    expect(await screen.findByText("cli")).toBeInTheDocument();
    const select = screen.getByLabelText("Expiración") as HTMLSelectElement;
    const options = Array.from(select.options).map((option) => option.textContent);
    expect(options).toEqual(["30 días", "90 días", "180 días"]);
    // F-01/A6: no unbounded option, and nothing the API would reject with 422.
    expect(options.some((label) => label === "Nunca")).toBe(false);
    expect(options.some((label) => label?.includes("365"))).toBe(false);
    expect(select.value).toBe("180");
  });
});
