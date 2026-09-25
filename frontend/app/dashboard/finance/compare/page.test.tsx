import { createElement as h } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard/finance/compare/",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    h("a", { href, ...rest }, children),
}));

import ComparePage from "./page";
import type { MovementWire } from "@/lib/api/finance";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

function movement(id: string, overrides: Partial<MovementWire> = {}): MovementWire {
  return {
    id,
    direction: "expense",
    amount: "100.00",
    occurred_on: "2026-09-24",
    description: null,
    account_id: "a1",
    category_id: "c1",
    subscription_id: null,
    created_at: "2026-09-24T10:00:00Z",
    updated_at: "2026-09-24T10:00:00Z",
    ...overrides,
  };
}

const categoryUrls: string[] = [];

const server = setupServer(
  http.get("http://test.local/api/me", () => {
    return HttpResponse.json({ preferences: { currency_code: "COP", locale: "es-CO" } });
  }),
  http.get("http://test.local/api/categories", ({ request }) => {
    categoryUrls.push(request.url);
    return HttpResponse.json([
      { id: "c1", kind: "finance", name: "Comida", color: null, icon: null, is_archived: false, created_at: "2026-09-01T00:00:00Z" },
      { id: "c2", kind: "finance", name: "Sueldo", color: null, icon: null, is_archived: false, created_at: "2026-09-01T00:00:00Z" },
      { id: "c3", kind: "subscription", name: "Streaming", color: null, icon: null, is_archived: false, created_at: "2026-09-01T00:00:00Z" },
      { id: "c4", kind: "habit", name: "Ejercicio", color: null, icon: null, is_archived: false, created_at: "2026-09-01T00:00:00Z" },
    ]);
  }),
  http.get("http://test.local/api/movements", () => {
    return HttpResponse.json([
      movement("m1", { category_id: "c1", direction: "expense", amount: "100.00", account_id: "a1" }),
      movement("m2", { category_id: "c1", direction: "income", amount: "20.00", account_id: "a1" }),
      movement("m3", { category_id: "c1", direction: "expense", amount: "999.00", account_id: "a2" }),
      movement("m4", { category_id: "c2", direction: "expense", amount: "50.00", account_id: "a1" }),
    ]);
  }),
  http.get("http://test.local/api/accounts", () => {
    return HttpResponse.json([
      { id: "a1", name: "Principal", type: "bank", currency: "COP", balance: "100000.00" },
      { id: "a2", name: "Bolsillo USD", type: "bank", currency: "USD", balance: "10.00" },
    ]);
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  categoryUrls.length = 0;
});
afterAll(() => server.close());

function renderPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ComparePage />
    </SWRConfig>,
  );
}

describe("compare page (movement split)", () => {
  it("warns when both picks are the same category", async () => {
    renderPage();
    const selectA = await screen.findByLabelText("Categoría A");
    fireEvent.change(selectA, { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("Categoría B"), { target: { value: "c1" } });
    expect(await screen.findByText("Elegí dos categorías distintas para compararlas.")).toBeInTheDocument();
  });

  it("shows expense and income side by side with no netted figure", async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText("Categoría A"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("Categoría B"), { target: { value: "c2" } });
    expect(await screen.findByRole("heading", { name: "Comida" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sueldo" })).toBeInTheDocument();
    const values = screen
      .getAllByRole("progressbar")
      .map((bar) => bar.getAttribute("aria-valuenow"));
    expect(values).toContain("100");
    expect(values).toContain("20");
    expect(values).not.toContain("80");
    expect(screen.getByText("Volver a Finanzas")).toHaveAttribute("href", "/dashboard/finance/");
  });

  it("excludes foreign-currency movements instead of mixing them", async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText("Categoría A"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("Categoría B"), { target: { value: "c2" } });
    const values = (await screen.findAllByRole("progressbar")).map((bar) =>
      bar.getAttribute("aria-valuenow"),
    );
    expect(values).not.toContain("999");
  });

  it("fetches one unfiltered category set and lists every kind together", async () => {
    renderPage();
    const selectA = await screen.findByLabelText("Categoría A");
    expect(await within(selectA).findByRole("option", { name: "Comida" })).toBeInTheDocument();
    expect(within(selectA).getByRole("option", { name: "Streaming" })).toBeInTheDocument();
    expect(within(selectA).getByRole("option", { name: "Ejercicio" })).toBeInTheDocument();
    expect(categoryUrls.length).toBeGreaterThan(0);
    for (const url of categoryUrls) {
      expect(new URL(url).searchParams.has("kind")).toBe(false);
    }
  });
});
