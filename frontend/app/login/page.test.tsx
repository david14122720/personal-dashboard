import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/login/",
}));

const server = setupServer(
  http.post("http://test.local/api/login", async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    if (body.email === "you@example.com" && body.password === "secret") {
      return HttpResponse.json({ token: "tok-123", expires_at: "2026-09-08T00:00:00Z" });
    }
    return HttpResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid credentials" } },
      { status: 401 },
    );
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
  replace.mockClear();
});
afterAll(() => server.close());

describe("login screen auth flow", () => {
  it("signs in, stores the token, and routes to the dashboard", async () => {
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "you@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(localStorage.getItem("dashboard-token")).toBe("tok-123");
    });
    expect(replace).toHaveBeenCalledWith("/dashboard/");
  });

  it("shows an alert on invalid credentials without storing a token", async () => {
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "you@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(localStorage.getItem("dashboard-token")).toBeNull();
    expect(replace).not.toHaveBeenCalledWith("/dashboard/");
  });
});
