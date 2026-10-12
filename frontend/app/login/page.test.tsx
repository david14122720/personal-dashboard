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

    fireEvent.change(screen.getByLabelText("Correo electrónico"), {
      target: { value: "you@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => {
      expect(localStorage.getItem("dashboard-token")).toBe("tok-123");
    });
    expect(replace).toHaveBeenCalledWith("/dashboard/");
  });

  it("shows an alert on invalid credentials without storing a token", async () => {
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("Correo electrónico"), {
      target: { value: "you@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(localStorage.getItem("dashboard-token")).toBeNull();
    expect(replace).not.toHaveBeenCalledWith("/dashboard/");
  });
});

describe("login screen control deck visuals", () => {
  it("toggles password visibility with an accessible button", () => {
    render(<LoginPage />);

    const password = screen.getByLabelText("Contraseña") as HTMLInputElement;
    expect(password.type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(password.type).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: "Ocultar contraseña" }));
    expect(password.type).toBe("password");
  });

  it("renders no control that claims behaviour the app lacks (JD item 9)", () => {
    render(<LoginPage />);

    expect(screen.getByRole("status")).toHaveTextContent("EN LÍNEA");
    expect(screen.getByText("v0.1.0")).toBeInTheDocument();

    // `Recordar sesión` wrote state nothing read and `¿Olvidaste tu
    // contraseña?` was an anchor whose handler did nothing: both are gone.
    expect(screen.queryByLabelText("Recordar sesión")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("link", { name: "¿Olvidaste tu contraseña?" })).toBeNull();

    expect(
      screen.getByText("Conexión segura cifrada de extremo a extremo"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Control Deck • Panel de administración y gestión privada"),
    ).toBeInTheDocument();
  });
});
