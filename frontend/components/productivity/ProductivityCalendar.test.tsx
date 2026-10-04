import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import ProductivityCalendar from "./ProductivityCalendar";
import { formatMonth, t } from "@/lib/i18n";
import { toEventRange } from "@/lib/finance/finance";
import {
  calendarDateLabel,
  monthGridRange,
  shiftMonth,
  todayYmdLocal,
} from "@/lib/productivity/productivity";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";
// The edge-day tests below must run in a UTC-negative zone: pin Bogota
// (UTC-5, no DST) before any fixture computes local dates.
process.env.TZ = "America/Bogota";

// Fixtures live in the real current month so the default month view shows them
// without freezing the clock; the previous month proves past months render.
const monthKey = todayYmdLocal().slice(0, 7);
const prevMonthKey = shiftMonth(monthKey, -1);
const day10 = `${monthKey}-10`;
const day12 = `${monthKey}-12`;
const prevDay10 = `${prevMonthKey}-10`;

function localIso(date: string, hour: number): string {
  return new Date(`${date}T${`${hour}`.padStart(2, "0")}:00:00`).toISOString();
}

/** Instant for a wall-clock time in Bogota (UTC-5, no DST). */
function bogotaIso(date: string, hour: number, minute = 0): string {
  const hh = `${hour}`.padStart(2, "0");
  const mm = `${minute}`.padStart(2, "0");
  return new Date(`${date}T${hh}:${mm}:00-05:00`).toISOString();
}

/** Backend `GET /events` overlap predicate: `starts_at < to` and
 * (`ends_at` is null or `ends_at > from`). */
function backendOverlap(
  event: { starts_at: string; ends_at: string | null },
  from: string | null,
  to: string | null,
): boolean {
  const start = Date.parse(event.starts_at);
  const end = event.ends_at ? Date.parse(event.ends_at) : null;
  if (to && !(start < Date.parse(to))) return false;
  if (from && end !== null && !(end > Date.parse(from))) return false;
  return true;
}

function task(id: string, title: string, due_date: string, priority = "high", status = "pending") {
  return {
    id,
    title,
    description: null,
    priority,
    status,
    due_date,
    completed_at: null,
    goal_id: null,
    sort_order: 0,
  };
}

const tasks = [
  task("t1", "Comprar zapatos", day10),
  task("t2", "Escribir plan", day10, "medium", "in_progress"),
  task("t3", "Tarea del mes pasado", prevDay10),
];

const events = [
  {
    id: "e1",
    title: "Dentista",
    description: null,
    kind: "appointment",
    starts_at: localIso(day10, 10),
    ends_at: localIso(day10, 11),
    all_day: false,
    location: "clínica",
  },
];

const eventRequests: URL[] = [];
const taskRequests: string[] = [];
let eventsFail = false;

const server = setupServer(
  http.get("http://test.local/api/tasks", ({ request }) => {
    taskRequests.push(new URL(request.url).pathname);
    return HttpResponse.json(tasks);
  }),
  http.get("http://test.local/api/events", ({ request }) => {
    eventRequests.push(new URL(request.url));
    if (eventsFail) return HttpResponse.error();
    return HttpResponse.json(events);
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  eventRequests.length = 0;
  taskRequests.length = 0;
  eventsFail = false;
});
afterAll(() => server.close());

function renderCalendar() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <ProductivityCalendar />
    </SWRConfig>,
  );
}

const triggerName = t("productivity.calendarTitle");

function openCalendar() {
  fireEvent.click(screen.getByRole("button", { name: triggerName }));
}

function dayCell(date: string): HTMLElement {
  const label = calendarDateLabel(date);
  const cell = screen
    .getAllByRole("gridcell")
    .find((node) => node.getAttribute("aria-label")?.includes(label));
  if (!cell) throw new Error(`No grid cell for ${date}`);
  return cell;
}

function detailName(date: string): string {
  return t("productivity.calendarDayDetail", { date: calendarDateLabel(date) });
}

describe("ProductivityCalendar", () => {
  it("stays collapsed by default without mounting the grid or fetching", () => {
    const { container } = renderCalendar();
    const trigger = screen.getByRole("button", { name: triggerName });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls", "productivity-calendar-panel");
    const panel = container.querySelector("#productivity-calendar-panel");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("hidden");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(eventRequests).toHaveLength(0);
    expect(taskRequests).toHaveLength(0);
  });

  it("toggles the Monday-first 42-cell grid open and closed", async () => {
    renderCalendar();
    openCalendar();
    const trigger = screen.getByRole("button", { name: triggerName });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const grid = await screen.findByRole("grid");
    expect(screen.getByText(formatMonth(monthKey))).toBeInTheDocument();
    expect(grid).toHaveAttribute("aria-colcount", "7");
    expect(grid).toHaveAttribute("aria-rowcount", "7");
    expect(within(grid).getAllByRole("columnheader").map((node) => node.textContent)).toEqual(
      t("productivity.calendarWeekdays").split(","),
    );
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(42);
    fireEvent.click(trigger);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("distinguishes task and event markers without colour alone", async () => {
    renderCalendar();
    openCalendar();
    await screen.findByRole("grid");

    const busy = dayCell(day10);
    const taskMarker = busy.querySelector('[data-marker="task"]') as HTMLElement | null;
    const eventMarker = busy.querySelector('[data-marker="event"]') as HTMLElement | null;
    expect(taskMarker).not.toBeNull();
    expect(eventMarker).not.toBeNull();
    expect(taskMarker?.textContent).toContain("2");
    expect(eventMarker?.textContent).toContain("1");
    expect(taskMarker?.querySelector("span")?.className ?? "").not.toContain("rounded-full");
    expect(eventMarker?.querySelector("span")?.className ?? "").toContain("rounded-full");
    const label = busy.getAttribute("aria-label") ?? "";
    expect(label).toContain(calendarDateLabel(day10));
    expect(label).toContain("2 tareas");
    expect(label).toContain("1 evento");

    const quiet = dayCell(day12);
    expect(quiet.querySelector("[data-marker]")).toBeNull();
    expect(quiet.getAttribute("aria-label")).toContain(t("productivity.calendarDayEmptyLabel", { date: calendarDateLabel(day12) }));
  });

  it("reveals a day's detail with tasks and events, and collapses it again", async () => {
    renderCalendar();
    openCalendar();
    await screen.findByRole("grid");

    const cell = dayCell(day10);
    fireEvent.click(cell);
    const detail = await screen.findByRole("region", { name: detailName(day10) });
    expect(within(detail).getByText("Comprar zapatos")).toBeInTheDocument();
    expect(within(detail).getByText("Escribir plan")).toBeInTheDocument();
    expect(within(detail).getByText("Dentista")).toBeInTheDocument();
    expect(within(detail).getByText("alta · pendiente")).toBeInTheDocument();
    expect(within(detail).getByText("media · en curso")).toBeInTheDocument();
    expect(within(detail).getByText(/cita ·/)).toBeInTheDocument();

    fireEvent.click(cell);
    expect(screen.queryByRole("region", { name: detailName(day10) })).not.toBeInTheDocument();
  });

  it("keeps at most one day open and collapses with Escape", async () => {
    renderCalendar();
    openCalendar();
    await screen.findByRole("grid");

    fireEvent.click(dayCell(day10));
    const detail = await screen.findByRole("region", { name: detailName(day10) });
    fireEvent.click(dayCell(day12));
    expect(screen.queryByRole("region", { name: detailName(day10) })).not.toBeInTheDocument();
    const next = await screen.findByRole("region", { name: detailName(day12) });
    expect(within(next).getByText(t("productivity.calendarEmptyDay"))).toBeInTheDocument();

    fireEvent.keyDown(detail, { key: "Escape" });
    fireEvent.keyDown(next, { key: "Escape" });
    expect(screen.queryByRole("region", { name: detailName(day12) })).not.toBeInTheDocument();
  });

  it("fetches events with both RFC 3339 bounds and covers past months", async () => {
    renderCalendar();
    openCalendar();
    await waitFor(() => expect(eventRequests.length).toBeGreaterThanOrEqual(1));
    const current = toEventRange(monthGridRange(monthKey), 1);
    expect(eventRequests[0].searchParams.get("from")).toBe(current.from);
    expect(eventRequests[0].searchParams.get("to")).toBe(current.to);
    expect(eventRequests[0].searchParams.get("from")).toContain("T00:00:00.000Z");
    expect(eventRequests[0].searchParams.get("to")).toContain("T23:59:59.999Z");

    fireEvent.click(screen.getByRole("button", { name: t("productivity.calendarPrev") }));
    await waitFor(() => expect(eventRequests.length).toBeGreaterThanOrEqual(2));
    const prev = eventRequests[eventRequests.length - 1];
    const expected = toEventRange(monthGridRange(prevMonthKey), 1);
    expect(prev.searchParams.get("from")).toBe(expected.from);
    expect(prev.searchParams.get("to")).toBe(expected.to);
    expect(dayCell(prevDay10).querySelector('[data-marker="task"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("productivity.calendarToday") }));
    expect(screen.getByText(formatMonth(monthKey))).toBeInTheDocument();
  });

  it("announces loading with a status while still rendering the grid", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("http://test.local/api/tasks", async () => {
        await gate;
        return HttpResponse.json(tasks);
      }),
    );
    renderCalendar();
    openCalendar();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getAllByRole("gridcell")).toHaveLength(42);
    release();
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("shows an alert and retries both reads", async () => {
    eventsFail = true;
    renderCalendar();
    openCalendar();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t("productivity.calendarLoadFailed"));
    const eventsBefore = eventRequests.length;
    const tasksBefore = taskRequests.length;
    eventsFail = false;
    fireEvent.click(within(alert).getByRole("button", { name: t("common.retry") }));
    await waitFor(() => expect(eventRequests.length).toBeGreaterThan(eventsBefore));
    await waitFor(() => expect(taskRequests.length).toBeGreaterThan(tasksBefore));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("renders an empty month with zero counts and an empty day detail", async () => {
    server.use(
      http.get("http://test.local/api/tasks", () => HttpResponse.json([])),
      http.get("http://test.local/api/events", () => HttpResponse.json([])),
    );
    renderCalendar();
    openCalendar();
    await screen.findByRole("grid");
    await waitFor(() => expect(screen.queryByText(t("common.loading"))).not.toBeInTheDocument());
    expect(screen.getAllByRole("gridcell")).toHaveLength(42);
    expect(document.querySelector("[data-marker]")).toBeNull();
    expect(screen.getByText(t("productivity.calendarEmptyMonth"))).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("gridcell")[10]);
    expect(await screen.findByText(t("productivity.calendarEmptyDay"))).toBeInTheDocument();
  });

  it("keeps every control at least 44px and reduced-motion safe", async () => {
    renderCalendar();
    openCalendar();
    await screen.findByRole("grid");
    for (const name of [t("productivity.calendarPrev"), t("productivity.calendarNext"), t("productivity.calendarToday")]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("min-h-[44px]");
      expect(button.className).toContain("min-w-[44px]");
    }
    for (const cell of screen.getAllByRole("gridcell")) {
      expect(cell.className).toContain("min-h-[44px]");
      expect(cell.className).toContain("min-w-[44px]");
    }
    const panel = document.querySelector("#productivity-calendar-day-panel");
    expect(panel?.className).toContain("motion-reduce:transition-none");

    fireEvent.click(dayCell(day10));
    await screen.findByRole("region", { name: detailName(day10) });
    expect(document.querySelector("#productivity-calendar-day-panel")?.className).toContain(
      "motion-reduce:transition-none",
    );
  });
});

// The grid bounds are local days while the API query is UTC: a margin is
// needed around both edges or the backend drops events the client would
// place on a visible local day (UTC-negative zones hit the last day hardest).
describe("ProductivityCalendar local-day edges (America/Bogota)", () => {
  it("fetches an event starting late on the last visible local day", async () => {
    const grid = monthGridRange(monthKey);
    // Premise: Bogota is UTC-5, so the last visible local day reaches five
    // hours past the UTC midnight the un-widened query stopped at.
    expect(new Date(`${grid.to}T12:00:00`).getTimezoneOffset()).toBe(300);
    const late = {
      id: "edge-late",
      title: "Cierre tardío",
      description: null,
      kind: "event",
      starts_at: bogotaIso(grid.to, 22, 30),
      ends_at: bogotaIso(grid.to, 23, 30),
      all_day: false,
      location: null,
    };
    server.use(
      http.get("http://test.local/api/events", ({ request }) => {
        const url = new URL(request.url);
        return HttpResponse.json(
          [late].filter((event) =>
            backendOverlap(event, url.searchParams.get("from"), url.searchParams.get("to")),
          ),
        );
      }),
    );
    renderCalendar();
    openCalendar();
    await screen.findByRole("grid");

    await waitFor(() =>
      expect(dayCell(grid.to).querySelector('[data-marker="event"]')).not.toBeNull(),
    );
    fireEvent.click(dayCell(grid.to));
    const detail = await screen.findByRole("region", { name: detailName(grid.to) });
    expect(within(detail).getByText("Cierre tardío")).toBeInTheDocument();
  });

  it("fetches an event starting early on the first visible local day", async () => {
    const grid = monthGridRange(monthKey);
    const early = {
      id: "edge-early",
      title: "Madrugada",
      description: null,
      kind: "event",
      starts_at: bogotaIso(grid.from, 0, 30),
      ends_at: bogotaIso(grid.from, 1, 30),
      all_day: false,
      location: null,
    };
    server.use(
      http.get("http://test.local/api/events", ({ request }) => {
        const url = new URL(request.url);
        return HttpResponse.json(
          [early].filter((event) =>
            backendOverlap(event, url.searchParams.get("from"), url.searchParams.get("to")),
          ),
        );
      }),
    );
    renderCalendar();
    openCalendar();
    await screen.findByRole("grid");

    await waitFor(() =>
      expect(dayCell(grid.from).querySelector('[data-marker="event"]')).not.toBeNull(),
    );
    fireEvent.click(dayCell(grid.from));
    const detail = await screen.findByRole("region", { name: detailName(grid.from) });
    expect(within(detail).getByText("Madrugada")).toBeInTheDocument();
  });
});
