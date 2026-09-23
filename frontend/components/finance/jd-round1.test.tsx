import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import { AssetEditForm } from "./AssetForms";
import AnalysisSection from "./AnalysisSection";
import { t } from "@/lib/i18n";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderWithSWR(ui: React.ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>,
  );
}

describe("JD-ASSET AssetEditForm preserva categoría (RED)", () => {
  it("renombrar preserva categoría almacenada", async () => {
    let seen: Record<string, unknown> | null = null;
    server.use(
      http.patch("http://test.local/api/assets/a1", async ({ request }) => {
        seen = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "a1" });
      }),
    );
    renderWithSWR(
      <AssetEditForm
        assetId="a1"
        accounts={[{ id: "acc1", name: "Billetera" }]}
        initial={{ name: "Apartamento", category: "property" }}
        onDone={() => undefined}
      />,
    );
    // La categoría almacenada debe precargarse, no resetear a "other".
    expect(screen.getByLabelText(t("finance.category"))).toHaveValue("property");
    fireEvent.change(screen.getByLabelText(t("finance.goalName")), {
      target: { value: "Apartamento 2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(seen).not.toBeNull());
    expect(seen!.name).toBe("Apartamento 2");
    expect(seen!.category).toBe("property");
  });
});

describe("JD-INSIGHT AnalysisSection dirección (RED)", () => {
  const byCatExpense = [{ name: "Mercado", total: "1500.00" }];
  const byCatIncome = [{ name: "Salario", total: "6000.00" }];
  it("suba usa 'más'", () => {
    render(
      <AnalysisSection
        flow={[
          { month: "2026-08", income: "2000.00", expense: "1000.00" },
          { month: "2026-09", income: "2000.00", expense: "1200.00" },
        ]}
        byCatExpense={byCatExpense}
        byCatIncome={byCatIncome}
        budgets={[]}
        locale="es-CO"
        currency="COP"
      />,
    );
    expect(screen.getByText(/más/)).toBeInTheDocument();
  });
  it("baja usa 'menos'", () => {
    render(
      <AnalysisSection
        flow={[
          { month: "2026-08", income: "2000.00", expense: "1000.00" },
          { month: "2026-09", income: "2000.00", expense: "800.00" },
        ]}
        byCatExpense={byCatExpense}
        byCatIncome={byCatIncome}
        budgets={[]}
        locale="es-CO"
        currency="COP"
      />,
    );
    expect(screen.getByText(/menos/)).toBeInTheDocument();
  });
  it("cero es neutro (sin más/menos)", () => {
    render(
      <AnalysisSection
        flow={[
          { month: "2026-08", income: "2000.00", expense: "1000.00" },
          { month: "2026-09", income: "2000.00", expense: "1000.00" },
        ]}
        byCatExpense={byCatExpense}
        byCatIncome={byCatIncome}
        budgets={[]}
        locale="es-CO"
        currency="COP"
      />,
    );
    const items = screen.getAllByRole("listitem");
    const mom = items.map((li) => li.textContent ?? "").find((s) => s.includes("Mercado"));
    expect(mom).toBeDefined();
    expect(mom!).not.toMatch(/más/);
    expect(mom!).not.toMatch(/menos/);
  });
  it("tplMom intacta exige {pct}% con pct=18", () => {
    expect(
      t("analysis.tplMom", { pct: 18, cat: "Mercado", cur: "$ 500", prev: "$ 400" }),
    ).toContain("18%");
  });
});

describe("JD triangulate (bordes + defaults)", () => {
  it("toAssetEditInitial sin categoría → null (form defaultea other)", async () => {
    const { toAssetEditInitial } = await import("@/components/containers/FinanceScreens");
    // toAssetEditInitial sin categoría → null (form defaultea other).
    const init = toAssetEditInitial({ id: "a9", name: "Caja" });
    expect(init.category).toBeNull();
    const r2 = renderWithSWR(
      <AssetEditForm assetId="a9" accounts={[{ id: "acc1", name: "Billetera" }]} onDone={() => undefined} />,
    );
    expect(screen.getByLabelText(t("finance.category"))).toHaveValue("other");
    r2.unmount();
  });
  it("tplMomDown/tplMomFlat interpolan pct/cat y flat es neutro", () => {
    expect(t("analysis.tplMomDown", { pct: 20, cat: "Mercado", cur: "$ 800", prev: "$ 1000" })).toContain("20%");
    expect(t("analysis.tplMomDown", { pct: 20, cat: "Mercado", cur: "$ 800", prev: "$ 1000" })).toContain("menos");
    expect(t("analysis.tplMomDown", { pct: 20, cat: "Mercado", cur: "$ 800", prev: "$ 1000" })).toContain("Mercado");
    const flat = t("analysis.tplMomFlat", { pct: 0, cat: "Mercado", cur: "$ 1000", prev: "$ 1000" });
    expect(flat).toContain("Mercado");
    expect(flat).not.toMatch(/más/);
    expect(flat).not.toMatch(/menos/);
  });
});
