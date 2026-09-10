import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import BudgetForm from "./BudgetForm";
import { AssetEditForm } from "./AssetForms";
import AnalysisSection from "./AnalysisSection";
import { toBudgetFormValue } from "@/components/containers/FinanceScreens";
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

describe("JD-THRESH BudgetForm preserva thresholds (RED)", () => {
  it("editar solo notes preserva 0.5/1.3", async () => {
    let seen: Record<string, unknown> | null = null;
    server.use(
      http.patch("http://test.local/api/budgets/b1", async ({ request }) => {
        seen = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "b1" });
      }),
    );
    renderWithSWR(
      <BudgetForm
        categories={[{ id: "c1", name: "Mercado" }]}
        budget={{
          id: "b1",
          category_id: "c1",
          amount: "100000.00",
          period_start: "2026-09-01",
          period_end: "2026-09-30",
          warn_threshold: 0.5,
          over_threshold: 1.3,
          notes: "nota vieja",
        }}
        onDone={() => undefined}
      />,
    );
    // Editar solo notes: los inputs de umbral deben arrancar en 0.5/1.3.
    expect(screen.getByLabelText(t("finance.warnThreshold"))).toHaveValue("0.5");
    expect(screen.getByLabelText(t("finance.overThreshold"))).toHaveValue("1.3");
    fireEvent.change(screen.getByLabelText(t("finance.description")), {
      target: { value: "nota nueva" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(seen).not.toBeNull());
    expect(seen!.warn_threshold).toBe(0.5);
    expect(seen!.over_threshold).toBe(1.3);
    expect(seen!.notes).toBe("nota nueva");
  });
});

describe("JD-THRESH FinanceScreens wiring (RED)", () => {
  it("mapea warn/over/notes reales al BudgetForm", () => {
    const v = toBudgetFormValue({
      id: "b1",
      category_id: "c1",
      amount: "100000.00",
      currency: "COP",
      period_start: "2026-09-01",
      period_end: "2026-09-30",
      spent: "0.00",
      remaining: "100000.00",
      pct: 0,
      status: "ok",
      warn_threshold: 0.5,
      over_threshold: 1.3,
      notes: "hola",
    });
    expect(v.warn_threshold).toBe(0.5);
    expect(v.over_threshold).toBe(1.3);
    expect(v.notes).toBe("hola");
  });
});

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
  it("toBudgetFormValue sin thresholds → null (BudgetForm defaultea 0.8/1.0)", async () => {
    const { toAssetEditInitial } = await import("@/components/containers/FinanceScreens");
    const v = toBudgetFormValue({
      id: "b2",
      category_id: "c1",
      amount: "50000.00",
      currency: "COP",
      period_start: "2026-09-01",
      period_end: "2026-09-30",
      spent: "0.00",
      remaining: "50000.00",
      pct: 0,
      status: "ok",
    });
    expect(v.warn_threshold).toBeNull();
    expect(v.over_threshold).toBeNull();
    expect(v.notes).toBeNull();
    // BudgetForm con nulls debe mostrar defaults 0.8/1.0 sin romper.
    const { unmount } = renderWithSWR(
      <BudgetForm
        categories={[{ id: "c1", name: "Mercado" }]}
        budget={{ id: "b2", category_id: "c1", amount: "50000.00", period_start: "2026-09-01", period_end: "2026-09-30", warn_threshold: null, over_threshold: null, notes: null }}
        onDone={() => undefined}
      />,
    );
    expect(screen.getByLabelText(t("finance.warnThreshold"))).toHaveValue("0.8");
    expect(screen.getByLabelText(t("finance.overThreshold"))).toHaveValue("1");
    unmount();
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
