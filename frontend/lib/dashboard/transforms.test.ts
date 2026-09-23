import { describe, expect, it } from "vitest";
import {
  currentMonthKey,
  ledDotClass,
  monthsAgoStart,
  toActiveSubs,
  toFinanceScore,
  toFinanceSnapshot,
  toGoalProgress,
  toISODate,
  toMonthlyCost,
  toNotificationCount,
  toNotificationItems,
  toOutstandingDebt,
  toOverdueItems,
  toPendingDebts,
  toPendingTasks,
  toTotalSavings,
  toUpcomingEvents,
  toUpcomingPayments,
} from "./transforms";

describe("dashboard transforms", () => {
  it("maps backend enums 1:1 to LED tokens", () => {
    expect(ledDotClass("ok")).toBe("bg-flow");
    expect(ledDotClass("warn")).toBe("bg-signal");
    expect(ledDotClass("over")).toBe("bg-alert");
    expect(ledDotClass("high")).toBe("bg-alert");
    expect(ledDotClass("bogus")).toBe("bg-instrument/30");
    expect(ledDotClass(null)).toBe("bg-instrument/30");
  });

  it("formats date helpers as local calendar strings", () => {
    const now = new Date(2026, 8, 7); // September 7, 2026 (local)
    expect(currentMonthKey(now)).toBe("2026-09");
    expect(monthsAgoStart(now, 11)).toBe("2025-10-01");
    expect(toISODate(now)).toBe("2026-09-07");
  });
});

describe("toMonthlyCost (S3b)", () => {
  const sub = (frequency: string, price: string | number = "12000.00", is_active = true) => ({
    price,
    frequency,
    is_active,
  });

  it.each([
    ["daily", 30],
    ["weekly", 52 / 12],
    ["biweekly", 26 / 12],
    ["monthly", 1],
    ["quarterly", 1 / 3],
    ["semiannual", 1 / 6],
    ["annual", 1 / 12],
  ])("converts %s with its factor", (frequency, factor) => {
    expect(toMonthlyCost([sub(frequency, 1200)])).toBeCloseTo(1200 * (factor as number), 6);
  });

  it("excludes inactive subscriptions", () => {
    expect(toMonthlyCost([sub("monthly", "5000", false)])).toBe(0);
    expect(toMonthlyCost([sub("monthly", "5000", false), sub("monthly", "3000")])).toBe(3000);
  });

  it("excludes unknown frequencies instead of assuming 1x", () => {
    expect(toMonthlyCost([sub("fortnightly", "9999")])).toBe(0);
    expect(toMonthlyCost([sub("monthly", "1000"), sub("mystery", "9999")])).toBe(1000);
  });

  it("returns 0 for empty, null or undefined", () => {
    expect(toMonthlyCost([])).toBe(0);
    expect(toMonthlyCost(null)).toBe(0);
    expect(toMonthlyCost(undefined)).toBe(0);
  });
});

describe("toOutstandingDebt / toTotalSavings / toFinanceSnapshot (S3b)", () => {
  it("sums pending_amount over active debts only", () => {
    expect(
      toOutstandingDebt([
        { pending_amount: "500.00", status: "active" },
        { pending_amount: "100.00", status: "paid_off" },
        { pending_amount: 200, status: "active" },
      ]),
    ).toBe(700);
    expect(toOutstandingDebt([])).toBe(0);
    expect(toOutstandingDebt(null)).toBe(0);
  });

  it("sums saved_amount over non-completed goals only", () => {
    expect(
      toTotalSavings([
        { saved_amount: "100.00" },
        { saved: "50.00", is_completed: true },
        { saved_amount: 25, completed: false },
      ]),
    ).toBe(125);
    expect(toTotalSavings([])).toBe(0);
    expect(toTotalSavings(undefined)).toBe(0);
  });

  it("passes the snapshot values through with no period window", () => {
    expect(toFinanceSnapshot({ netWorth: 80, monthlySubsCost: 10, outstandingDebt: 20 })).toEqual({
      netWorth: 80,
      monthlySubsCost: 10,
      outstandingDebt: 20,
    });
  });
});

describe("toFinanceScore (S3b)", () => {
  it("computes the share of the positive position not owed", () => {
    expect(toFinanceScore({ netWorth: 80, savings: 20, debt: 100 })).toBeCloseTo(50);
  });

  it("returns null when all three inputs are zero", () => {
    expect(toFinanceScore({ netWorth: 0, savings: 0, debt: 0 })).toBeNull();
  });

  it("returns 100 when debt-free with a positive position", () => {
    expect(toFinanceScore({ netWorth: 80, savings: 20, debt: 0 })).toBe(100);
  });

  it("clamps an underwater position to 0", () => {
    expect(toFinanceScore({ netWorth: -200, savings: 0, debt: 100 })).toBe(0);
  });
});

describe("upcoming payments 7d union (PR1 RED)", () => {
  const now = new Date(2026, 8, 7, 12, 0, 0);
  const isoDay = (offset: number) => {
    const d = new Date(2026, 8, 7 + offset);
    const m = `${d.getMonth() + 1}`.padStart(2, "0");
    const day = `${d.getDate()}`.padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  };

  it("unions subs+debts+payment_due ordered debt > event > sub", () => {
    const subs = [{ id: "s1", name: "Netflix", price: "15000.00", is_active: true, next_billing_on: isoDay(5) }];
    const debts = [
      { id: "d1", name: "Tarjeta", pending_amount: "500.00", status: "active", due_date: isoDay(2) },
    ];
    const events = [
      { id: "e1", title: "Cuota", kind: "payment_due", starts_at: new Date(2026, 8, 9, 10, 0, 0).toISOString() },
    ];
    const items = toUpcomingPayments(subs, debts, events, now);
    expect(items.map((i) => i.id)).toEqual(["d1", "e1", "s1"]);
    expect(items[0]).toMatchObject({ kind: "debt" });
  });

  it("includes today and hoy+7, excludes hoy+8", () => {
    const subs = [
      { id: "today", name: "Hoy", price: 10, is_active: true, next_billing_on: isoDay(0) },
      { id: "plus7", name: "+7", price: 10, is_active: true, next_billing_on: isoDay(7) },
      { id: "plus8", name: "+8", price: 10, is_active: true, next_billing_on: isoDay(8) },
    ];
    const items = toUpcomingPayments(subs, [], [], now);
    expect(items.map((i) => i.id).sort()).toEqual(["plus7", "today"]);
  });

  it("excludes dateless active debt", () => {
    const debts = [{ id: "nodate", name: "Sin fecha", pending_amount: "100.00", status: "active", due_date: null }];
    expect(toUpcomingPayments([], debts, [], now)).toEqual([]);
  });
});

describe("overdue items (PR1 RED)", () => {
  const now = new Date(2026, 8, 7, 12, 0, 0);
  const isoDay = (offset: number) => {
    const d = new Date(2026, 8, 7 + offset);
    const m = `${d.getMonth() + 1}`.padStart(2, "0");
    const day = `${d.getDate()}`.padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  };

  it("derives task+debt overdue; event-today stays upcoming (JD-A-001)", () => {
    const tasks = [{ id: "t1", title: "Vencida", status: "pending", due_date: isoDay(-1) }];
    const debts = [{ id: "d1", name: "Deuda", pending_amount: "200.00", status: "active", due_date: isoDay(-1) }];
    const events = [
      {
        id: "e1",
        title: "Cobro",
        kind: "payment_due",
        starts_at: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      },
    ];
    const items = toOverdueItems(tasks, debts, events, now);
        // JD-A-001: evento de hoy (hora pasada, dia vigente) va solo a Proximos.
    expect(items.map((i) => i.id).sort()).toEqual(["d1", "t1"]);
  });

  it("excludes future and completed", () => {
    const tasks = [
      { id: "future", title: "Futura", status: "pending", due_date: isoDay(2) },
      { id: "done", title: "Hecha", status: "completed", due_date: isoDay(-2) },
    ];
    const debts = [{ id: "paid", name: "Pagada", pending_amount: 10, status: "paid_off", due_date: isoDay(-5) }];
    expect(toOverdueItems(tasks, debts, [], now)).toEqual([]);
  });
});

describe("payment_due hoy sin doble conteo (JD-A-001)", () => {
      const now = new Date(2026, 8, 7, 12, 0, 0); // hoy 12:00 local
      const atToday = (h: number, m = 0) => new Date(2026, 8, 7, h, m, 0).toISOString(); // hoy HH:MM local
      const event = (id: string, starts_at: string) => ({
        id,
        title: `E${id}`,
        kind: "payment_due" as const,
        starts_at,
      });

      it("evento hoy 09:00 (ya pasó la hora, no el día) no cae en Vencidas; badge total = 1", () => {
        const e = event("e1", atToday(9));
        const overdue = toOverdueItems([], [], [e], now);
        const upcoming = toUpcomingPayments([], [], [e], now);
        expect(overdue).toEqual([]);
        expect(upcoming.map((i) => i.id)).toEqual(["e1"]);
        const items = toNotificationItems(overdue, upcoming);
        expect(items).toHaveLength(1);
        expect(toNotificationCount(items, {}, null)).toBe(1);
      });

      it("evento de ayer 23:00 (día anterior) sigue en Vencidas", () => {
        const e = event("e2", new Date(2026, 8, 6, 23, 0, 0).toISOString());
        expect(toOverdueItems([], [], [e], now).map((i) => i.id)).toEqual(["e2"]);
        expect(toUpcomingPayments([], [], [e], now)).toEqual([]);
      });

      it("evento hoy 23:59 futuro queda solo en Próximos", () => {
        const e = event("e3", atToday(23, 59));
        expect(toOverdueItems([], [], [e], now)).toEqual([]);
        expect(toUpcomingPayments([], [], [e], now).map((i) => i.id)).toEqual(["e3"]);
      });
    });

describe("pending lists + goal progress + notifications (PR1 RED)", () => {
  const now = new Date(2026, 8, 7, 12, 0, 0);
  const isoDay = (offset: number) => {
    const d = new Date(2026, 8, 7 + offset);
    const m = `${d.getMonth() + 1}`.padStart(2, "0");
    const day = `${d.getDate()}`.padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  };

  it("filters active debts and active subs ordered asc", () => {
    const debts = [
      { id: "d1", name: "A", pending_amount: "500.00", status: "active", due_date: isoDay(3) },
      { id: "d2", name: "B", pending_amount: "100.00", status: "paid_off", due_date: isoDay(1) },
    ];
    const pending = toPendingDebts(debts);
    expect(pending.map((d) => d.id)).toEqual(["d1"]);
    expect(pending[0].pending).toBe(500);
    const subs = [
      { id: "s1", name: "On", price: "9000.00", is_active: true, next_billing_on: isoDay(4) },
      { id: "s2", name: "Off", price: 10, is_active: false, next_billing_on: isoDay(1) },
    ];
    const active = toActiveSubs(subs);
    expect(active.map((s) => s.id)).toEqual(["s1"]);
    expect(active[0].price).toBe(9000);
  });

  it("filters pending tasks and orders by due asc", () => {
    const tasks = [
      { id: "t2", title: "B", status: "pending", due_date: isoDay(3) },
      { id: "t1", title: "A", status: "in_progress", due_date: isoDay(1) },
      { id: "done", title: "Done", status: "completed", due_date: isoDay(0) },
    ];
    expect(toPendingTasks(tasks).map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("keeps 14d event visible in widget but out of 7d bell", () => {
    const events = [
      { id: "e10", title: "Lejano", kind: "event", starts_at: new Date(2026, 8, 17, 10, 0, 0).toISOString() },
    ];
    expect(toUpcomingEvents(events, now).map((e) => e.id)).toEqual(["e10"]);
    expect(toUpcomingPayments([], [], [{ id: "e10", title: "Lejano", kind: "event", starts_at: events[0].starts_at }], now)).toEqual([]);
  });

  it("computes two goal segments Metas vs Ahorro", () => {
    const progress = toGoalProgress(
      [{ id: "g1", name: "Correr", progress: 60, status: "active" }],
      [{ id: "sg1", name: "Viaje", goal: "200.00", saved: "100.00" }],
    );
    expect(progress.goals[0]).toMatchObject({ id: "g1", pct: 60 });
    expect(progress.savings[0]).toMatchObject({ id: "sg1", pct: 50 });
  });

  it("counts badge minus muted and hidden sources", () => {
    const overdue = [
      { id: "a", kind: "debt" as const, title: "A", due: isoDay(-1), source: "debt" },
      { id: "b", kind: "task" as const, title: "B", due: isoDay(-2), source: "task" },
    ];
    const upcoming = [
      { id: "c", kind: "subscription" as const, title: "C", due: isoDay(1), source: "subscription" },
      { id: "d", kind: "event" as const, title: "D", due: isoDay(2), source: "event" },
      { id: "e", kind: "debt" as const, title: "E", due: isoDay(3), source: "debt" },
    ];
    const items = toNotificationItems(overdue, upcoming);
    expect(items).toHaveLength(5);
    expect(toNotificationCount(items, { c: true }, null)).toBe(4);
    expect(toNotificationCount(items, {}, new Set(["debt", "task"]))).toBe(3);
  });
});

describe("triangulate TZ/RFC3339 + installment (PR1)", () => {
  const now = new Date(2026, 8, 7, 12, 0, 0);
  const isoDay = (offset: number) => {
    const d = new Date(2026, 8, 7 + offset);
    const m = `${d.getMonth() + 1}`.padStart(2, "0");
    const day = `${d.getDate()}`.padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  };

  it("parses RFC3339 events inside the 7d window and rejects invalid dates", () => {
    const good = new Date(2026, 8, 10, 15, 30, 0).toISOString();
    const items = toUpcomingPayments(
      [],
      [],
      [
        { id: "good", title: "OK", kind: "payment_due", starts_at: good },
        { id: "bad", title: "Bad", kind: "payment_due", starts_at: "not-a-date" },
        { id: "other-kind", title: "Otro", kind: "event", starts_at: good },
      ],
      now,
    );
    expect(items.map((i) => i.id)).toEqual(["good"]);
  });

  it("never invents dates from installment money", () => {
    const dateless = [{ id: "d1", name: "Cuota", pending_amount: "300.00", status: "active", due_date: null, installment: "50.00" }];
    expect(toUpcomingPayments([], dateless, [], now)).toEqual([]);
    // With a real due_date the installment amount does not change the date used.
    const dated = [{ id: "d2", name: "Cuota", pending_amount: "300.00", status: "active", due_date: isoDay(2), installment: "50.00" }];
    const items = toUpcomingPayments([], dated, [], now);
    expect(items).toHaveLength(1);
    expect(items[0].due).toBe(isoDay(2));
    expect(items[0].amount).toBe(300);
  });

  it("orders null due_dates last and clamps goal pct", () => {
    const debts = [
      { id: "nodate", name: "N", pending_amount: 10, status: "active", due_date: null },
      { id: "dated", name: "D", pending_amount: 10, status: "active", due_date: isoDay(2) },
    ];
    expect(toPendingDebts(debts).map((d) => d.id)).toEqual(["dated", "nodate"]);
    const progress = toGoalProgress(
      [{ id: "g", name: "G", progress: 250, status: "active" }],
      [
        { id: "sg-alt", name: "Alt", target_amount: "200.00", saved_amount: "300.00", is_completed: false },
        { id: "sg-zero", name: "Zero", goal: 0, saved: 50 },
      ],
    );
    expect(progress.goals[0].pct).toBe(100);
    expect(progress.savings[0].pct).toBe(100);
    expect(progress.savings[1].pct).toBe(0);
  });
});
