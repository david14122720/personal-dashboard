import { describe, expect, it } from "vitest";
import { toInsights } from "./finance";

// JD-INSIGHT RED: finance.ts debe emitir dirección con pct absoluto.
// Suba → dir up + "más", baja → dir down + "menos", cero → flat neutro.
describe("JD-INSIGHT toInsights dirección (RED)", () => {
  const byCat = [{ name: "Mercado", total: "1500.00" }];
  it("suba: pct absoluto 20 + dir up", () => {
    const insights = toInsights({
      flow: [
        { month: "2026-08", income: "2000.00", expense: "1000.00" },
        { month: "2026-09", income: "2000.00", expense: "1200.00" },
      ],
      byCatExpense: byCat,
      byCatIncome: [],
      budgets: [],
    });
    const mom = insights.find((i) => i.kind === "mom-expense");
    expect(mom).toBeDefined();
    expect(mom!.vars.pct).toBe(20);
    expect(String(mom!.vars.dir)).toBe("up");
  });
  it("baja: pct absoluto 20 + dir down", () => {
    const insights = toInsights({
      flow: [
        { month: "2026-08", income: "2000.00", expense: "1000.00" },
        { month: "2026-09", income: "2000.00", expense: "800.00" },
      ],
      byCatExpense: byCat,
      byCatIncome: [],
      budgets: [],
    });
    const mom = insights.find((i) => i.kind === "mom-expense");
    expect(mom).toBeDefined();
    expect(mom!.vars.pct).toBe(20);
    expect(String(mom!.vars.dir)).toBe("down");
  });
  it("cero: pct 0 + dir flat neutro", () => {
    const insights = toInsights({
      flow: [
        { month: "2026-08", income: "2000.00", expense: "1000.00" },
        { month: "2026-09", income: "2000.00", expense: "1000.00" },
      ],
      byCatExpense: byCat,
      byCatIncome: [],
      budgets: [],
    });
    const mom = insights.find((i) => i.kind === "mom-expense");
    expect(mom).toBeDefined();
    expect(mom!.vars.pct).toBe(0);
    expect(String(mom!.vars.dir)).toBe("flat");
  });
});

// JD-INSIGHT TRIANGULATE: bordes prev==0, ambos cero, un mes sin MoM, pct siempre absoluto.
import { describe as describeT, expect as expectT, it as itT } from "vitest";
describeT("JD-INSIGHT triangulate", () => {
  const byCat = [{ name: "Mercado", total: "10.00" }];
  itT("prev==0 con suba → dir up pct 0 (sin división)", () => {
    const mom = toInsights({
      flow: [
        { month: "2026-08", income: "100.00", expense: "0.00" },
        { month: "2026-09", income: "2000.00", expense: "500.00" },
      ],
      byCatExpense: byCat,
      byCatIncome: [],
      budgets: [],
    }).find((i) => i.kind === "mom-expense");
    expectT(mom).toBeDefined();
    expectT(mom!.vars.pct).toBe(0);
    expectT(String(mom!.vars.dir)).toBe("up");
  });
  itT("ambos cero → flat pct 0", () => {
    const mom = toInsights({
      flow: [
        { month: "2026-08", income: "0.00", expense: "0.00" },
        { month: "2026-09", income: "0.00", expense: "0.00" },
      ],
      byCatExpense: byCat,
      byCatIncome: [],
      budgets: [],
    }).find((i) => i.kind === "mom-expense");
    expectT(mom).toBeDefined();
    expectT(mom!.vars.pct).toBe(0);
    expectT(String(mom!.vars.dir)).toBe("flat");
  });
  itT("un mes no emite MoM", () => {
    const kinds = toInsights({
      flow: [{ month: "2026-09", income: "2000.00", expense: "800.00" }],
      byCatExpense: byCat,
      byCatIncome: [],
      budgets: [],
    }).map((i) => i.kind);
    expectT(kinds).not.toContain("mom-expense");
  });
  itT("pct siempre absoluto aunque baje 50%", () => {
    const mom = toInsights({
      flow: [
        { month: "2026-08", income: "2000.00", expense: "1000.00" },
        { month: "2026-09", income: "2000.00", expense: "500.00" },
      ],
      byCatExpense: byCat,
      byCatIncome: [],
      budgets: [],
    }).find((i) => i.kind === "mom-expense");
    expectT(mom!.vars.pct).toBe(50);
    expectT(Number(mom!.vars.pct) >= 0).toBe(true);
  });
});
