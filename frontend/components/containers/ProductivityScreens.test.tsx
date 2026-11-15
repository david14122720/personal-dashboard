import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import type { EventWire } from "@/lib/api/productivity";
import { t } from "@/lib/i18n";
import ProductivityScreens from "./ProductivityScreens";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";
const API = "http://test.local/api";
/** The single read the screen must issue: the unbounded owned list. */
const EVENTS_URL = `${API}/events?shape=brief`;

/**
 * RFC 3339 instant at a local wall-clock hour, `dayOffset` days from today.
 * The screen's "today" is the local calendar day (`toISODate` for the KPI
 * bounds, `eventOverlapsDate` for the derived list), so fixtures must be built
 * on that same clock or they rot when the test runs near midnight.
 */
function localInstant(dayOffset: number, hour: number): string {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function event(
  id: string,
  title: string,
  starts_at: string,
  ends_at: string | null = null,
): EventWire {
  return { id, title, kind: "event", starts_at, ends_at, all_day: false, location: null };
}

/** Two of the four events touch the local day; the other two do not, so a KPI
 * fed from a narrower read can never coincidentally match `TODAY_COUNT`. The
 * spanning one (started yesterday, ends today) is the boundary that pins "the
 * same bounds the derivation already used". */
const TODAY_COUNT = 2;

function eventsFixture(): EventWire[] {
  return [
    event("e1", "Cobro de ayer", localInstant(-1, 10)),
    event("e2", "Trasnoche", localInstant(-1, 22), localInstant(0, 2)),
    event("e3", "Reunión de hoy", localInstant(0, 23)),
    event("e4", "Viaje de la próxima semana", localInstant(7, 10)),
  ];
}

let events: EventWire[] = [];
/** While set, `/events` stays unanswered so the loading state can be pinned. */
let eventsPending = false;
/** Every URL the screen actually requested, in order. */
let requested: string[] = [];

function json(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as Response;
}

/** Backend-shaped `from`/`to` predicate: a reopened bounded read answers with a
 * different payload instead of silently reusing the full list. */
function ranged(from: string | null, to: string | null): EventWire[] {
  if (!from && !to) return events;
  const start = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
  const end = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
  return events.filter((item) => {
    const itemStart = Date.parse(item.starts_at);
    const itemEnd = item.ends_at ? Date.parse(item.ends_at) : itemStart;
    return itemStart <= end && itemEnd >= start;
  });
}

const fetchMock = vi.fn((input: RequestInfo | URL) => {
  const url = new URL(String(input));
  requested.push(url.toString());
  if (url.pathname === "/api/events") {
    if (eventsPending) return new Promise<Response>(() => {});
    return Promise.resolve(json(ranged(url.searchParams.get("from"), url.searchParams.get("to"))));
  }
  // Goals, tasks and the notes search stay empty: only the today KPI is pinned here.
  return Promise.resolve(json([]));
});
vi.stubGlobal("fetch", fetchMock);

function eventsRequests(): string[] {
  return requested.filter((url) => new URL(url).pathname === "/api/events");
}

function renderScreens() {
  return render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 0,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
      }}
    >
      <ProductivityScreens />
    </SWRConfig>,
  );
}

beforeEach(() => {
  events = eventsFixture();
  eventsPending = false;
  requested = [];
  fetchMock.mockClear();
});

describe("S18 · la pantalla de productividad lee /events una sola vez", () => {
  it("hace una única request sin rango y el KPI de hoy sale de la lista derivada", async () => {
    renderScreens();
    // The KPI label only mounts once every read settled, so the request budget
    // is already final when this resolves.
    const kpiLabel = await screen.findByText(t("productivity.kpiTodayEvents"));
    expect(eventsRequests()).toEqual([EVENTS_URL]);

    const tile = kpiLabel.closest("article");
    expect(tile).not.toBeNull();
    expect(within(tile as HTMLElement).getByText(String(TODAY_COUNT))).toBeInTheDocument();
    expect(
      within(tile as HTMLElement).getByText(t("productivity.kpiTodayEventsUnitMany", { n: TODAY_COUNT })),
    ).toBeInTheDocument();

    // The Eventos card derives its «Hoy» pill from the same `allEvents` list, so
    // both figures must agree (one derivation, no second "today" definition).
    const eventTabs = screen.getByRole("group", { name: t("productivity.events") });
    expect(
      within(eventTabs).getByRole("button", { name: `${t("productivity.viewToday")} (${TODAY_COUNT})` }),
    ).toBeInTheDocument();
    expect(
      within(eventTabs).getByRole("button", { name: `${t("productivity.viewAllEvents")} (4)` }),
    ).toBeInTheDocument();
  });

  it("mientras /events carga deja el KPI en su skeleton sin abrir un segundo rango", async () => {
    eventsPending = true;
    renderScreens();
    expect(
      await screen.findByRole("status", { name: t("productivity.kpiLoading") }),
    ).toBeInTheDocument();
    // Same loading behaviour as before: the tile row is the skeleton, not a
    // zero-valued KPI, and the pending read is still the only events request.
    expect(screen.queryByText(t("productivity.kpiTodayEvents"))).not.toBeInTheDocument();
    expect(eventsRequests()).toEqual([EVENTS_URL]);
  });
});
