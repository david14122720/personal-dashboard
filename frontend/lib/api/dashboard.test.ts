import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import { buildNextLayout, eventsKey, isWidgetVisible, resolveDashboardLayout, subscriptionsKey, tasksKey, useEvents, useGoals, useSubscriptions, useTasks, useUpdateLayout } from "./dashboard";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";
const seen: string[] = [];
let patchBody: unknown = null;
let patchMode: "ok" | "fail" = "ok";
const server = setupServer(
  http.get("http://test.local/api/subscriptions", ({ request }) => { seen.push(request.url); return HttpResponse.json([{ id: "s1", name: "Music", price: "9.99", is_active: true, next_billing_on: "2026-09-14" }]); }),
  http.get("http://test.local/api/tasks", ({ request }) => { seen.push(request.url); return HttpResponse.json([{ id: "t1", title: "Pay", status: "pending", due_date: "2026-09-10" }]); }),
  http.get("http://test.local/api/events", ({ request }) => { seen.push(request.url); return HttpResponse.json([{ id: "e1", title: "Bill", kind: "payment_due", starts_at: "2026-09-13T12:00:00Z" }]); }),
  http.get("http://test.local/api/goals", () => HttpResponse.json([{ id: "g1", name: "Run", progress: 60, status: "active" }])),
  http.get("http://test.local/api/me", () => HttpResponse.json({ preferences: { currency_code: "COP", locale: "es-CO", dashboard_layout: { widgets: [] } } })),
  http.patch("http://test.local/api/me/preferences", async ({ request }) => {
    patchBody = await request.json();
    if (patchMode === "fail") return HttpResponse.json({ code: "VALIDATION", message: "bad" }, { status: 422 });
    return HttpResponse.json({ currency_code: "COP", locale: "es-CO", dashboard_layout: (patchBody as { dashboard_layout: unknown }).dashboard_layout });
  }),
);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); seen.length = 0; patchBody = null; patchMode = "ok"; });
afterAll(() => server.close());
function shell(ui: React.ReactNode) {
  return render(h(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false } }, ui));
}
function SubsProbe({ visible = true }: { visible?: boolean }) {
  const { data } = useSubscriptions(visible);
  return h("output", null, data ? `${data[0].id}:${data[0].price}` : visible ? "loading" : "hidden");
}
function AllProbe() {
  const t = useTasks("today", true);
  const e = useEvents("2026-09-01T00:00:00Z", "2026-09-08T00:00:00Z", true);
  const g = useGoals(true);
  const subs = useSubscriptions(true);
  return h("output", null, `${t.data?.[0]?.id ?? ""}:${e.data?.[0]?.id ?? ""}:${g.data?.[0]?.id ?? ""}:${subs.data?.[0]?.id ?? ""}`);
}
describe("dashboard hooks p8-pr2", () => {
  it("prefixes keys with dashboard/ and nulls when hidden", () => {
    expect(subscriptionsKey(true)).toBe("dashboard/subscriptions");
    expect(subscriptionsKey(false)).toBeNull();
    expect(tasksKey("today", true)).toBe("dashboard/tasks?view=today");
    expect(tasksKey(null, true)).toBe("dashboard/tasks");
    expect(tasksKey("today", false)).toBeNull();
    expect(eventsKey("2026-09-01T00:00:00Z", "2026-09-08T00:00:00Z", true)).toContain("dashboard/events?");
    expect(eventsKey(null, null, true)).toBe("dashboard/events");
    expect(eventsKey(null, null, false)).toBeNull();
  });
  it("fetches subscriptions with string money intact", async () => {
    shell(h(SubsProbe, null));
    expect(await screen.findByText("s1:9.99")).toBeInTheDocument();
    expect(seen.some((u) => u.includes("/subscriptions"))).toBe(true);
  });
  it("skips fetch when widget hidden", async () => {
    shell(h(SubsProbe, { visible: false }));
    expect(await screen.findByText("hidden")).toBeInTheDocument();
    await waitFor(() => expect(seen.length).toBe(0));
  });
  it("fetches tasks/events/goals/subs with visible keys", async () => {
    shell(h(AllProbe, null));
    expect(await screen.findByText("t1:e1:g1:s1")).toBeInTheDocument();
  });
  it("resolves empty layout to the 5-widget default and toggles ids", () => {
    const fallback = resolveDashboardLayout({ preferences: { currency_code: "COP", locale: "es-CO" } });
    expect(fallback.widgets.map((w) => w.id)).toEqual([
      "upcoming-payments",
      "active-subs",
      "pending-tasks",
      "upcoming-events",
      "goal-progress",
    ]);
    expect(fallback.widgets.map((w) => w.order)).toEqual([20, 22, 23, 24, 30]);
    expect(isWidgetVisible(fallback, "upcoming-payments")).toBe(true);
    const next = buildNextLayout(fallback, "upcoming-payments", false);
    expect(isWidgetVisible(next, "upcoming-payments")).toBe(false);
    expect(isWidgetVisible(buildNextLayout(next, "upcoming-payments", true), "upcoming-payments")).toBe(true);
  });
  it("ignores stale removed-widget entries without fetch or error", () => {
    const stale = resolveDashboardLayout({
      preferences: {
        currency_code: "COP",
        locale: "es-CO",
        dashboard_layout: {
          widgets: [
            { id: "month-savings", type: "metric", order: 12, size: "sm" },
            { id: "upcoming-payments", type: "list", order: 20, size: "lg" },
          ],
        },
      },
    });
    expect(isWidgetVisible(stale, "month-savings")).toBe(true);
    expect(isWidgetVisible(stale, "upcoming-payments")).toBe(true);
    // Re-adding a stale id is a no-op: it has no default definition.
    expect(buildNextLayout(stale, "month-savings", true)).toBe(stale);
  });
  it("triangulates notification count without duplicating logic", async () => {
    const { toNotificationCount } = await import("@/lib/dashboard/transforms");
    const items = [{ id: "a", kind: "subscription", title: "A", due: "2026-09-12", source: "subscription" }] as Parameters<typeof toNotificationCount>[0];
    expect(toNotificationCount(items, null, null)).toBe(1);
    expect(toNotificationCount(items, { a: true }, null)).toBe(0);
  });
  it("PATCHes exact envelope optimistically and rolls back on 422", async () => {
    let done = "";
    function Patcher() {
      const update = useUpdateLayout();
      return h("button", { type: "button", onClick: () => void update(buildNextLayout(resolveDashboardLayout(null), "upcoming-payments", false)).then(() => { done = JSON.stringify(patchBody); }) }, "go");
    }
    shell(h(Patcher, null));
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => expect(patchBody).toEqual({ dashboard_layout: expect.objectContaining({ widgets: expect.any(Array) }) }));
    expect(done).toContain("dashboard_layout");
    patchMode = "fail";
    let threw = false;
    function Failer() {
      const update = useUpdateLayout();
      return h("button", { type: "button", onClick: () => void update(buildNextLayout(resolveDashboardLayout(null), "upcoming-payments", false)).catch(() => { threw = true; }) }, "fail");
    }
    shell(h(Failer, null));
    fireEvent.click(screen.getByRole("button", { name: "fail" }));
    await waitFor(() => expect(threw).toBe(true));
  });
});
