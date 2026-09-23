import { createElement as h } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const server = setupServer(
  http.get("http://test.local/api/me", () => {
    return HttpResponse.json({ preferences: { currency_code: "COP", locale: "es-CO" } });
  }),
  http.get("http://test.local/api/categories", () => {
    return HttpResponse.json([
      { id: "c1", kind: "finance", name: "Comida", color: null, icon: null, is_archived: false, created_at: "2026-09-01T00:00:00Z" },
      { id: "c2", kind: "finance", name: "Sueldo", color: null, icon: null, is_archived: false, created_at: "2026-09-01T00:00:00Z" },
    ]);
  }),
  http.get("http://test.local/api/subscriptions", () => {
    return HttpResponse.json([
      { id: "s1", name: "Music", price: "12000", currency: "COP", frequency: "monthly", next_billing_on: null, is_active: true, category_id: "c1" },
    ]);
  }),
  http.get("http://test.local/api/savings-goals", () => {
    return HttpResponse.json([
      { id: "g1", name: "Fondo", target_amount: "100000", saved_amount: "25000", currency: "COP", is_completed: false, target_date: null, category_id: "c2" },
    ]);
  }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ComparePage />
    </SWRConfig>,
  );
}

describe("compare page", () => {
  it("warns when both picks are the same category", async () => {
    renderPage();
    const selectA = await screen.findByLabelText("Categoría A");
    fireEvent.change(selectA, { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("Categoría B"), { target: { value: "c1" } });
    expect(await screen.findByText("Elegí dos categorías distintas para compararlas.")).toBeInTheDocument();
  });

  it("renders both category totals side by side", async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText("Categoría A"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("Categoría B"), { target: { value: "c2" } });
    expect(await screen.findByRole("heading", { name: "Comida" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sueldo" })).toBeInTheDocument();
    expect(screen.getByText("Volver a Finanzas")).toHaveAttribute("href", "/dashboard/finance/");
  });
});
