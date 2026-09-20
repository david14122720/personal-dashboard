import { createElement as h } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/dashboard/habitos/",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    h("a", { href, ...rest }, children),
}));

import HabitosPage from "./page";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const habits = [
  {
    habit_id: "h1",
    name: "Morning Run",
    habit_frequency: "daily",
    days_of_week: [],
    current_streak: 5,
    today_status: "pending",
  },
];

const logs = [{ habit_id: "h1", log_date: "2026-09-01", status: "done" }];

const server = setupServer(
  http.get("http://test.local/api/habits/today", () => HttpResponse.json(habits)),
  http.get("http://test.local/api/habits/logs", () => HttpResponse.json(logs)),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
  replace.mockClear();
});
afterAll(() => server.close());

function renderPage() {
  return render(
    h(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, h(HabitosPage, null)),
  );
}

describe("habitos page", () => {
  it("renders the habits heading and the month-grid tracker anchor", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    const { container } = renderPage();

    expect(await screen.findByRole("heading", { name: "Hábitos" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Rastreador de hábitos" })).toBeInTheDocument();
    const anchor = container.querySelector("#rastreador-habitos");
    expect(anchor).not.toBeNull();
    expect(await screen.findByRole("grid", { name: "Rastreador de hábitos" })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalledWith("/login/");
  });

  it("redirects to login without a token", () => {
    renderPage();

    expect(replace).toHaveBeenCalledWith("/login/");
  });

  it("shows the tracker error with retry when habits fail to load", async () => {
    localStorage.setItem("dashboard-token", "tok-123");
    server.use(
      http.get("http://test.local/api/habits/today", () =>
        HttpResponse.json({ code: "INTERNAL", message: "boom" }, { status: 500 }),
      ),
    );
    renderPage();

    expect(await screen.findByText("No se pudo cargar el rastreador")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("No se pudo cargar el rastreador")).toBeInTheDocument();
  });
});
