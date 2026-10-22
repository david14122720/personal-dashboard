import { createElement as h } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import {
  movementsSummaryKey,
  useMovementsSummary,
  type MovementSummaryWire,
} from "./finance";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const seen: string[] = [];

const PAYLOAD: MovementSummaryWire = {
  totals: { expense: "25000.00", income: "80000.00", count: 3 },
  by_account: [{ account_id: "a1", expense: "25000.00", income: "80000.00" }],
  by_category: [{ category_id: "c1", expense: "25000.00", income: "0.00" }],
  buckets: [
    { key: "2026-10", from: "2026-10-01", to: "2026-10-31", expense: "25000.00", income: "80000.00" },
  ],
  recent: [],
  recent_total: 3,
};

const server = setupServer(
  http.get("http://test.local/api/movements/summary", ({ request }) => {
    seen.push(request.url);
    return HttpResponse.json(PAYLOAD);
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seen.length = 0;
});
afterAll(() => server.close());

function SummaryProbe() {
  const { data, error } = useMovementsSummary({
    from: "2026-10-01",
    to: "2026-10-31",
    group: "month",
  });
  return h(
    "output",
    null,
    error
      ? "error"
      : data
        ? `${data.totals.expense}:${data.buckets[0].key}:${data.recent_total}`
        : "loading",
  );
}

function shell(ui: React.ReactNode) {
  return render(
    h(
      SWRConfig,
      { value: { provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false } },
      ui,
    ),
  );
}

describe("movements summary hook (S1/T5)", () => {
  it("builds the SWR key with from, to and group; null keeps the read idle", () => {
    expect(
      movementsSummaryKey({ from: "2026-10-01", to: "2026-10-31", group: "month" }),
    ).toBe("finance/movements-summary:2026-10-01:2026-10-31:month");
    // The prefix keeps every `finance/movements` retry predicate working.
    expect(
      movementsSummaryKey({ from: "2026-10-01", to: "2026-10-31", group: "month" }),
    ).toMatch(/^finance\/movements/);
    expect(movementsSummaryKey(null)).toBeNull();
    expect(movementsSummaryKey({ from: "2026-10-31", to: "2026-10-01", group: "day" })).toBeNull();
    expect(movementsSummaryKey({ from: "", to: "2026-10-31", group: "day" })).toBeNull();
  });

  it("requests the pinned contract and exposes the wire payload untouched", async () => {
    shell(h(SummaryProbe, null));
    expect(await screen.findByText("25000.00:2026-10:3")).toBeInTheDocument();
    const url = new URL(seen[0]);
    expect(url.pathname).toBe("/api/movements/summary");
    expect(url.searchParams.get("from")).toBe("2026-10-01");
    expect(url.searchParams.get("to")).toBe("2026-10-31");
    expect(url.searchParams.get("group")).toBe("month");
  });

  it("does not request anything while the window is missing", async () => {
    function IdleProbe() {
      const { data } = useMovementsSummary(null);
      return h("output", null, data ? "data" : "idle");
    }
    shell(h(IdleProbe, null));
    expect(await screen.findByText("idle")).toBeInTheDocument();
    await waitFor(() => expect(seen).toHaveLength(0));
  });
});
