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

interface LoginBody {
  email: string;
  password: string;
  remember_me?: boolean;
}

const loginBodies: LoginBody[] = [];

const server = setupServer(
  http.post("http://test.local/api/login", async ({ request }) => {
    const body = (await request.json()) as LoginBody;
    loginBodies.push(body);
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
  loginBodies.length = 0;
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

  it("renders an unchecked Recordarme checkbox by default and posts remember_me: false", async () => {
    render(<LoginPage />);

    const remember = screen.getByLabelText("Recordarme") as HTMLInputElement;
    expect(remember.type).toBe("checkbox");
    expect(remember.checked).toBe(false);

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
    expect(loginBodies.at(-1)).toEqual({
      email: "you@example.com",
      password: "secret",
      remember_me: false,
    });
  });

  it("posts remember_me: true when Recordarme is checked", async () => {
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("Correo electrónico"), {
      target: { value: "you@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByLabelText("Recordarme"));
    expect((screen.getByLabelText("Recordarme") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => {
      expect(loginBodies.length).toBe(1);
    });
    expect(loginBodies[0]).toEqual({
      email: "you@example.com",
      password: "secret",
      remember_me: true,
    });
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

  it("drops the EN LÍNEA badge and keeps no password-recovery link", () => {
    render(<LoginPage />);

    // S1/S2: the static status pill (and its role) is gone from the header.
    expect(screen.queryByText("EN LÍNEA")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("v0.1.0")).toBeInTheDocument();

    // The app still has no password-recovery flow, so no anchor claims one.
    expect(screen.queryByRole("link", { name: "¿Olvidaste tu contraseña?" })).toBeNull();

    expect(
      screen.getByText("Conexión segura cifrada de extremo a extremo"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Control Deck • Panel de administración y gestión privada"),
    ).toBeInTheDocument();
  });
});

describe("login screen brand logo", () => {
  it("renders the official logo inside the square glow tile", () => {
    const { container } = render(<LoginPage />);

    const logo = container.querySelector('img[src="/logo.svg"]');
    expect(logo).not.toBeNull();
    expect(logo!.getAttribute("alt")).toBe("Control Deck");
    // Aspect-ratio 1:1 container (h-12 w-12 glow tile).
    expect(logo!.parentElement).toHaveClass("h-12");
    expect(logo!.parentElement).toHaveClass("w-12");
  });
});
