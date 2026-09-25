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
  toOverdueItems,
  toPendingTasks,
  toUpcomingEvents,
  toUpcomingPayments,
} from "./transforms";

// NOTE (S-F): toOutstandingDebt / toTotalSavings were deleted in S-H and
// toPendingDebts was deleted in S-F with its last consumer (PendingDebts
// widget). No removed-figure transform remains.

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

describe("toFinanceSnapshot (S-H: net worth + sub cost only)", () => {
  it("passes the two surviving values through with no period window", () => {
    expect(toFinanceSnapshot({ netWorth: 80, monthlySubsCost: 10 })).toEqual({
      netWorth: 80,
      monthlySubsCost: 10,
    });
  });
});

describe("toFinanceScore (S-H: net-worth-only)", () => {
  it("returns 100 when net worth is greater than zero", () => {
    expect(toFinanceScore({ netWorth: 80 })).toBe(100);
    expect(toFinanceScore({ netWorth: 0.01 })).toBe(100);
  });

  it("returns 0 when net worth is zero or negative, never a verdict", () => {
    expect(toFinanceScore({ netWorth: 0 })).toBe(0);
    expect(toFinanceScore({ netWorth: -200 })).toBe(0);
  });

  it("returns null when no net-worth data is available", () => {
    expect(toFinanceScore({ netWorth: null })).toBeNull();
    expect(toFinanceScore({ netWorth: undefined })).toBeNull();
  });
});

describe("upcoming payments 7d union (S-H: subs + events, no debts)", () => {
  const now = new Date(2026, 8, 7, 12, 0, 0);
  const isoDay = (offset: number) => {
    const d = new Date(2026, 8, 7 + offset);
    const m = `${d.getMonth() + 1}`.padStart(2, "0");
    const day = `${d.getDate()}`.padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  };

  it("unions subs+payment_due ordered event > sub on a tie", () => {
    const subs = [{ id: "s1", name: "Netflix", price: "15000.00", is_active: true, next_billing_on: isoDay(2) }];
    const events = [
      // Local midnight of the same day: a true tie, broken events > subs.
      { id: "e1", title: "Cuota", kind: "payment_due", starts_at: new Date(2026, 8, 9, 0, 0, 0).toISOString() },
    ];
    const items = toUpcomingPayments(subs, events, now);
    expect(items.map((i) => i.id)).toEqual(["e1", "s1"]);
    expect(items[0]).toMatchObject({ kind: "event" });
    expect(items[1]).toMatchObject({ kind: "subscription" });
  });

  it("includes today and hoy+7, excludes hoy+8", () => {
    const subs = [
      { id: "today", name: "Hoy", price: 10, is_active: true, next_billing_on: isoDay(0) },
      { id: "plus7", name: "+7", price: 10, is_active: true, next_billing_on: isoDay(7) },
      { id: "plus8", name: "+8", price: 10, is_active: true, next_billing_on: isoDay(8) },
    ];
    const items = toUpcomingPayments(subs, [], now);
    expect(items.map((i) => i.id).sort()).toEqual(["plus7", "today"]);
  });

  it("excludes inactive subs and dateless subs", () => {
    const subs = [
      { id: "off", name: "Off", price: 10, is_active: false, next_billing_on: isoDay(2) },
      { id: "nodate", name: "Sin fecha", price: 10, is_active: true, next_billing_on: null },
    ];
    expect(toUpcomingPayments(subs, [], now)).toEqual([]);
  });

  it("ignores non-payment_due events and invalid dates", () => {
    const good = new Date(2026, 8, 10, 15, 30, 0).toISOString();
    const items = toUpcomingPayments(
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
});

describe("overdue items (S-H: tasks + past events, no debts)", () => {
  const now = new Date(2026, 8, 7, 12, 0, 0);
  const isoDay = (offset: number) => {
    const d = new Date(2026, 8, 7 + offset);
    const m = `${d.getMonth() + 1}`.padStart(2, "0");
    const day = `${d.getDate()}`.padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  };

  it("derives overdue tasks plus past payment_due events; event-today stays upcoming (JD-A-001)", () => {
    const tasks = [{ id: "t1", title: "Vencida", status: "pending", due_date: isoDay(-1) }];
    const events = [
      {
        id: "e0",
        title: "Ayer",
        kind: "payment_due",
        starts_at: new Date(2026, 8, 6, 23, 0, 0).toISOString(),
      },
      {
        id: "e1",
        title: "Cobro",
        kind: "payment_due",
        starts_at: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      },
    ];
    const items = toOverdueItems(tasks, events, now);
    // JD-A-001: evento de hoy (hora pasada, dia vigente) va solo a Proximos.
    expect(items.map((i) => i.id).sort()).toEqual(["e0", "t1"]);
  });

  it("excludes future and completed", () => {
    const tasks = [
      { id: "future", title: "Futura", status: "pending", due_date: isoDay(2) },
      { id: "done", title: "Hecha", status: "completed", due_date: isoDay(-2) },
    ];
    expect(toOverdueItems(tasks, [], now)).toEqual([]);
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
        const overdue = toOverdueItems([], [e], now);
        const upcoming = toUpcomingPayments([], [e], now);
        expect(overdue).toEqual([]);
        expect(upcoming.map((i) => i.id)).toEqual(["e1"]);
        const items = toNotificationItems(overdue, upcoming);
        expect(items).toHaveLength(1);
        expect(toNotificationCount(items, {}, null)).toBe(1);
      });

      it("evento de ayer 23:00 (día anterior) sigue en Vencidas", () => {
        const e = event("e2", new Date(2026, 8, 6, 23, 0, 0).toISOString());
        expect(toOverdueItems([], [e], now).map((i) => i.id)).toEqual(["e2"]);
        expect(toUpcomingPayments([], [e], now)).toEqual([]);
      });

      it("evento hoy 23:59 futuro queda solo en Próximos", () => {
        const e = event("e3", atToday(23, 59));
        expect(toOverdueItems([], [e], now)).toEqual([]);
        expect(toUpcomingPayments([], [e], now).map((i) => i.id)).toEqual(["e3"]);
      });
    });

describe("pending lists + goal progress + notifications (S-H)", () => {
  const now = new Date(2026, 8, 7, 12, 0, 0);
  const isoDay = (offset: number) => {
    const d = new Date(2026, 8, 7 + offset);
    const m = `${d.getMonth() + 1}`.padStart(2, "0");
    const day = `${d.getDate()}`.padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  };

  it("filters active subs ordered asc", () => {
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
    expect(toUpcomingPayments([], [{ id: "e10", title: "Lejano", kind: "event", starts_at: events[0].starts_at }], now)).toEqual([]);
  });

  it("computes the metas-only goal segment, no savings segment", () => {
    const progress = toGoalProgress([
      { id: "g1", name: "Correr", progress: 60, status: "active" },
    ]);
    expect(progress.goals[0]).toMatchObject({ id: "g1", pct: 60 });
    expect(progress).not.toHaveProperty("savings");
  });

  it("clamps goal pct", () => {
    const progress = toGoalProgress([{ id: "g", name: "G", progress: 250, status: "active" }]);
    expect(progress.goals[0].pct).toBe(100);
  });

  it("counts badge minus muted and hidden sources", () => {
    const overdue = [
      { id: "a", kind: "event" as const, title: "A", due: isoDay(-1), source: "event" },
      { id: "b", kind: "task" as const, title: "B", due: isoDay(-2), source: "task" },
    ];
    const upcoming = [
      { id: "c", kind: "subscription" as const, title: "C", due: isoDay(1), source: "subscription" },
      { id: "d", kind: "event" as const, title: "D", due: isoDay(2), source: "event" },
    ];
    const items = toNotificationItems(overdue, upcoming);
    expect(items).toHaveLength(4);
    expect(toNotificationCount(items, { c: true }, null)).toBe(3);
    expect(toNotificationCount(items, {}, new Set(["event", "task"]))).toBe(3);
  });
});
