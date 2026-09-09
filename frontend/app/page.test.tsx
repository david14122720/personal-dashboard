import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

describe("root redirect page", () => {
  afterEach(() => {
    localStorage.clear();
    replace.mockClear();
  });

  it("shows Spanish loading copy and routes to login without a token", () => {
    render(<HomePage />);

    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith("/login/");
  });

  it("routes to the dashboard when a token exists", () => {
    localStorage.setItem("dashboard-token", "tok-123");
    render(<HomePage />);

    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith("/dashboard/");
  });
});
