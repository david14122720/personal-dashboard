import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import FinanceScreens from "@/components/containers/FinanceScreens";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const txPage1 = {
  items: [
    {
      id: "t3",
      account_id: "a1",
      type: "income",
      amount: "100.00",
      currency: "COP",
      occurred_on: "2026-09-03",
      category_id: null,
      description: "salary",
      notes: null,
      credit_card_account_id: null,
    },
    {
      id: "t2",
      account_id: "a1",
      type: "expense",
      amount: "20.00",
      currency: "COP",
      occurred_on: "2026-09-02",
      category_id: null,
      description: "groceries",
      notes: null,
      credit_card_account_id: null,
    },
  ],
  next_cursor: "CURSOR-PAGE-2",
  total_count: 3,
};

const txPage2 = {
  items: [
    {
      id: "t1",
      account_id: "a1",
      type: "expense",
      amount: "5.00",
      currency: "COP",
      occurred_on: "2026-09-01",
      category_id: null,
      description: "coffee",
      notes: null,
      credit_card_account_id: null,
    },
  ],
  next_cursor: null,
  total_count: 3,
};

const seenTxUrls: string[] = [];

const server = setupServer(
  http.get("http://test.local/api/transactions", ({ request }) => {
    seenTxUrls.push(request.url);
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    if (cursor === "CURSOR-PAGE-2") return HttpResponse.json(txPage2);
    return HttpResponse.json(txPage1);
  }),
  http.get("http://test.local/api/budgets", () => {
    return HttpResponse.json([
      {
        id: "b1",
        category_id: "c1",
        amount: "100.00",
        currency: "COP",
        period_start: "2026-09-01",
        period_end: "2026-09-30",
        spent: "85.00",
        remaining: "15.00",
        pct: 0.85,
        status: "warn",
      },
      {
        id: "b2",
        category_id: "c2",
        amount: "50.00",
        currency: "COP",
        period_start: "2026-09-01",
        period_end: "2026-09-30",
        spent: "60.00",
        remaining: "-10.00",
        pct: 1.2,
        status: "over",
      },
    ]);
  }),
  http.get("http://test.local/api/accounts", () => {
    return HttpResponse.json([
      {
        id: "a1",
        name: "Visa",
        type: "credit_card",
        currency: "COP",
        balance: "-500.00",
        credit_limit: "2000.00",
        used_balance: "500.00",
        available_balance: "1500.00",
        usage_pct: "25.00",
        alert_level: "warn",
        statement_balance: "320.50",
      },
      {
        id: "a2",
        name: "Wallet",
        type: "cash",
        currency: "COP",
        balance: "200.00",
        alert_level: null,
      },
    ]);
  }),
  http.get("http://test.local/api/subscriptions", () => {
    return HttpResponse.json([
      {
        id: "s1",
        name: "Music",
        price: "9.99",
        currency: "USD",
        frequency: "monthly",
        next_billing_on: "2026-10-01",
        is_active: true,
      },
    ]);
  }),
  http.get("http://test.local/api/debts", () => {
    return HttpResponse.json([
      {
        id: "d1",
        name: "Loan",
        creditor: "Bank",
        original_amount: "500.00",
        pending_amount: "320.00",
        currency: "COP",
        status: "active",
        due_date: "2026-12-01",
      },
    ]);
  }),
  http.get("http://test.local/api/savings-goals", () => {
    return HttpResponse.json([
      {
        id: "g1",
        name: "Trip",
        target_amount: "1000.00",
        saved_amount: "250.00",
        currency: "COP",
        is_completed: false,
        target_date: "2026-12-31",
      },
    ]);
  }),
  http.get("http://test.local/api/me", () => {
    return HttpResponse.json({ preferences: { currency_code: "COP", locale: "es-CO" } });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seenTxUrls.length = 0;
});
afterAll(() => server.close());

function renderScreens() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <FinanceScreens />
    </SWRConfig>,
  );
}

function ledgerSection(): HTMLElement {
  return screen.getByRole("region", { name: "Transactions ledger" });
}

describe("finance screens", () => {
  it("renders the ledger first page with count and a Load more button", async () => {
    renderScreens();
    const ledger = ledgerSection();
    expect(await within(ledger).findByText("salary")).toBeInTheDocument();
    expect(await within(ledger).findByText("groceries")).toBeInTheDocument();
    expect(await within(ledger).findByText("Showing 2 of 3 transactions")).toBeInTheDocument();
    expect(within(ledger).getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("appends page 2 through the opaque keyset cursor and hides Load more at the end", async () => {
    renderScreens();
    const ledger = ledgerSection();
    await within(ledger).findByText("groceries");

    fireEvent.click(within(ledger).getByRole("button", { name: "Load more" }));
    expect(await within(ledger).findByText("coffee")).toBeInTheDocument();
    expect(await within(ledger).findByText("Showing 3 of 3 transactions")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(ledger).queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    });
    expect(seenTxUrls.some((url) => url.includes("cursor=CURSOR-PAGE-2"))).toBe(true);
  });

  it("reuses the shared LED mapping for budget status and card alert levels", async () => {
    renderScreens();
    expect(await screen.findByRole("img", { name: "COP 100 · 2026-09-01 status warn" })).toHaveClass("bg-signal");
    expect(await screen.findByRole("img", { name: "COP 50 · 2026-09-01 status over" })).toHaveClass("bg-alert");
    expect(await screen.findByRole("img", { name: "Visa status warn" })).toHaveClass("bg-signal");
  });

  it("shows card usage metrics and the statement balance when present", async () => {
    renderScreens();
    const accounts = await screen.findByRole("region", { name: "Accounts" });
    expect(within(accounts).getByText("Visa")).toBeInTheDocument();
    expect(within(accounts).getByText(/25\.0%/)).toBeInTheDocument();
    expect(within(accounts).getByText(/statement/)).toBeInTheDocument();
    expect(within(accounts).getByText("Wallet")).toBeInTheDocument();
  });

  it("renders subscriptions, debts, and savings with money detail", async () => {
    renderScreens();
    expect(await screen.findByText("Music")).toBeInTheDocument();
    expect(await screen.findByText("Loan · Bank")).toBeInTheDocument();
    expect(await screen.findByText("Trip")).toBeInTheDocument();
    expect(await screen.findByText("25% saved")).toBeInTheDocument();
  });

  it("shows empty states when every finance endpoint returns nothing", async () => {
    server.use(
      http.get("http://test.local/api/transactions", () => {
        return HttpResponse.json({ items: [], next_cursor: null, total_count: 0 });
      }),
      http.get("http://test.local/api/budgets", () => HttpResponse.json([])),
      http.get("http://test.local/api/accounts", () => HttpResponse.json([])),
      http.get("http://test.local/api/subscriptions", () => HttpResponse.json([])),
      http.get("http://test.local/api/debts", () => HttpResponse.json([])),
      http.get("http://test.local/api/savings-goals", () => HttpResponse.json([])),
    );
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <FinanceScreens />
      </SWRConfig>,
    );
    const ledger = ledgerSection();
    expect(await within(ledger).findByText("No transactions yet")).toBeInTheDocument();
    expect(await screen.findByText("No budgets yet")).toBeInTheDocument();
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
  });

  it("shows an error alert with retry when aggregate reads fail", async () => {
    server.use(http.get("http://test.local/api/budgets", () => HttpResponse.error()));
    render(
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        <FinanceScreens />
      </SWRConfig>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Finance sections failed to load");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
