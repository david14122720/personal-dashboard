import { createElement as h } from "react";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Mutable shell fixtures: the path, the `useHabitsToday` and the
 * `usePreferences` results per test. */
const state = vi.hoisted(() => ({
  path: "/dashboard/",
  habits: {
    data: undefined as { habit_id: string }[] | undefined,
    isLoading: true,
    error: undefined as unknown,
  },
  prefs: {
    data: undefined as
      | { email?: string | null; display_name?: string | null }
      | undefined,
    isLoading: true,
    error: undefined as unknown,
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.path,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    h("a", { href, ...rest }, children),
}));

// The real NotificationBell renders; only its data hook is stubbed so the shell
// can be asserted without network or MSW handlers.
vi.mock("@/components/notifications/useNotifications", () => ({
  useNotifications: () => ({
    overdue: [],
    upcoming: [],
    count: 2,
    muted: {},
    toggleMute: vi.fn(),
  }),
}));

vi.mock("@/lib/api/dashboard", () => ({
  useHabitsToday: () => state.habits,
  usePreferences: () => state.prefs,
}));

vi.mock("@/lib/api/client", () => ({ logout: vi.fn() }));

import AppShell from "./AppShell";

function renderShell() {
  return render(h(AppShell, null, h("p", { "data-testid": "child" }, "contenido")));
}

/** The rail nav is the only navigation with seven destinations. */
function railNav(): HTMLElement {
  const rail = screen
    .getAllByRole("navigation")
    .find((nav) => within(nav).queryAllByRole("link").length === 7);
  if (!rail) throw new Error("rail navigation not found");
  return rail;
}

/** The bottom tab bar is the only navigation with five destinations. */
function tabNav(): HTMLElement {
  const tabs = screen
    .getAllByRole("navigation")
    .find((nav) => within(nav).queryAllByRole("link").length === 5);
  if (!tabs) throw new Error("mobile tab navigation not found");
  return tabs;
}

beforeEach(() => {
  state.path = "/dashboard/";
  state.habits = { data: undefined, isLoading: true, error: undefined };
  state.prefs = { data: undefined, isLoading: true, error: undefined };
});

describe("AppShell rail", () => {
  it("groups the real destinations under the design's Plataforma / Sistema headers", () => {
    renderShell();
    expect(screen.getByText("Plataforma")).toBeInTheDocument();
    expect(screen.getByText("Sistema")).toBeInTheDocument();
    expect(screen.queryByText("Principal")).not.toBeInTheDocument();
    expect(screen.queryByText("Configuración")).not.toBeInTheDocument();
    const labels = within(railNav())
      .getAllByRole("link")
      .map((link) => link.textContent?.trim());
    expect(labels).toEqual([
      "Dashboard",
      "Finanzas",
      "Productividad",
      "Hábitos",
      "Ajustes",
      "Tokens de API",
      "Sesiones",
    ]);
  });

  it("paints the active rail item with the deck recipe and marks it for assistive tech", () => {
    state.path = "/dashboard/finance/";
    renderShell();
    const links = screen.getAllByRole("link", { name: "Finanzas" });
    const rail = links.find((link) => link.className.includes("px-3.5"));
    const idle = screen
      .getAllByRole("link", { name: "Dashboard" })
      .find((link) => link.className.includes("px-3.5"));
    expect(rail?.getAttribute("aria-current")).toBe("page");
    expect(rail?.className).toContain("bg-sky-500/10");
    expect(rail?.className).toContain("border-sky-500/30");
    expect(rail?.querySelector("span.ml-auto")).not.toBeNull();
    expect(idle?.getAttribute("aria-current")).toBeNull();
    expect(idle?.className).toContain("hover:bg-card");
  });

  it("shows the real active-habits chip only when the count is known and non-zero", () => {
    state.habits = {
      data: [{ habit_id: "h1" }, { habit_id: "h2" }, { habit_id: "h3" }],
      isLoading: false,
      error: undefined,
    };
    renderShell();
    expect(within(railNav()).getByText("3 activos")).toBeInTheDocument();
  });

  it("renders no habits chip while the count is unknown", () => {
    renderShell();
    expect(screen.queryByText(/activos/)).not.toBeInTheDocument();
  });

  it("renders no habits chip for an empty list and for a failed fetch", () => {
    state.habits = { data: [], isLoading: false, error: undefined };
    const empty = renderShell();
    expect(screen.queryByText(/activos/)).not.toBeInTheDocument();
    empty.unmount();
    state.habits = { data: undefined, isLoading: false, error: new Error("offline") };
    renderShell();
    expect(screen.queryByText(/activos/)).not.toBeInTheDocument();
  });
});

describe("AppShell mobile chrome", () => {
  it("keeps exactly the five design destinations and marks the current one", () => {
    state.path = "/dashboard/habitos/";
    renderShell();
    const tabs = tabNav();
    const links = within(tabs).getAllByRole("link");
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Dashboard",
      "Finanzas",
      "Productividad",
      "Hábitos",
      "Ajustes",
    ]);
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual([
      null,
      null,
      null,
      "page",
      null,
    ]);
    expect(links[0].className).toContain("min-w-[56px]");
    expect(links[3].className).toContain("text-signal");
    expect(within(tabs).queryByRole("link", { name: "Tokens de API" })).toBeNull();
    expect(within(tabs).queryByRole("link", { name: "Sesiones" })).toBeNull();
  });

  it("stays reachable: every table destination keeps its own link in the shell", () => {
    renderShell();
    expect(screen.getAllByRole("link", { name: "Tokens de API" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Sesiones" }).length).toBeGreaterThan(0);
  });
});

describe("AppShell identity footer", () => {
  it("renders the real signed-in name, email and initials from `GET /me`", () => {
    state.prefs = {
      data: { email: "david@example.com", display_name: "David Rojas" },
      isLoading: false,
      error: undefined,
    };
    renderShell();
    expect(screen.getByText("David Rojas")).toBeInTheDocument();
    expect(screen.getByText("david@example.com")).toBeInTheDocument();
    expect(screen.getByText("DR")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
    // The prototype's invented identity is still never rendered.
    expect(screen.queryByText("Admin Dev")).not.toBeInTheDocument();
    expect(screen.queryByText("admin@controldeck.io")).not.toBeInTheDocument();
  });

  it("falls back to the real email alone and derives its initials without inventing a name", () => {
    state.prefs = {
      data: { email: "david@example.com", display_name: "" },
      isLoading: false,
      error: undefined,
    };
    renderShell();
    expect(screen.getByText("david@example.com")).toBeInTheDocument();
    expect(screen.getByText("DA")).toBeInTheDocument();
    expect(screen.queryByText("Sesión local")).not.toBeInTheDocument();
    expect(screen.queryByText("Admin Dev")).not.toBeInTheDocument();
  });

  it("keeps the honest local-session fallback while the identity read is loading or failed", () => {
    renderShell();
    expect(screen.getByText("Sesión local")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
    // The compact mobile logout keeps a distinct accessible name so the shell
    // never exposes two identically named controls.
    expect(screen.getByRole("button", { name: "Salir" })).toBeInTheDocument();
    expect(screen.queryByText("Admin Dev")).not.toBeInTheDocument();
    expect(screen.queryByText("admin@controldeck.io")).not.toBeInTheDocument();
  });

  it("keeps the fallback for an empty identity payload and a failed read", () => {
    state.prefs = { data: {}, isLoading: false, error: undefined };
    const empty = renderShell();
    expect(screen.getByText("Sesión local")).toBeInTheDocument();
    empty.unmount();
    state.prefs = { data: undefined, isLoading: false, error: new Error("offline") };
    renderShell();
    expect(screen.getByText("Sesión local")).toBeInTheDocument();
  });

  it("names the mobile avatar link with its destination and the real identity (JD item 7)", () => {
    state.prefs = {
      data: { email: "david@example.com", display_name: "David Rojas" },
      isLoading: false,
      error: undefined,
    };
    renderShell();
    const link = screen.getByRole("link", { name: "Ajustes de sesión · David Rojas" });
    expect(link).toHaveAttribute("href", "/dashboard/ajustes/");
    // The old name claimed a session state without saying where the link goes.
    expect(screen.queryByRole("link", { name: "Sesión local" })).toBeNull();
  });

  it("still names the destination while the identity read has not answered (JD item 7)", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "Ajustes de sesión" })).toHaveAttribute(
      "href",
      "/dashboard/ajustes/",
    );
  });

  it("renders the brand block in both chrome branches", () => {
    renderShell();
    expect(screen.getAllByText("v0.1.0")).toHaveLength(2);
    expect(screen.getByText("Centro de Mando")).toBeInTheDocument();
  });
});

describe("AppShell top bar", () => {
  it("keeps the breadcrumb locale-correct and no field that cannot search", () => {
    state.path = "/dashboard/habitos/";
    const { container } = renderShell();
    expect(screen.getByText("Panel")).toBeInTheDocument();
    // The decorative global search was removed by owner order: a field that
    // cannot search is not a field, so the top bar keeps no inert input.
    expect(screen.queryByPlaceholderText("Buscar…")).toBeNull();
    expect(container.querySelector("header input")).toBeNull();
    expect(screen.getByText(/de \d{4}/)).toBeInTheDocument();
  });

  it("renders the notification surface once per screen on every route", () => {
    state.path = "/dashboard/finance/";
    const finance = renderShell();
    expect(screen.getByText("Avisos")).toBeInTheDocument();
    expect(screen.getAllByTestId("p8-badge").map((badge) => badge.textContent)).toEqual(["2", "2"]);
    finance.unmount();
    // The dashboard route is no longer special: the shell owns the bell there
    // too, so the desktop and compact branches are both rendered exactly once.
    state.path = "/dashboard/";
    renderShell();
    expect(screen.getAllByTestId("p8-badge").map((badge) => badge.textContent)).toEqual(["2", "2"]);
    expect(screen.getAllByRole("button", { name: /avisos pendientes/ })).toHaveLength(2);
  });

  it("adds no dead shell CTA (the activity CTA lives in the Dashboard header)", () => {
    renderShell();
    expect(screen.queryByRole("button", { name: /Registrar actividad/ })).toBeNull();
  });

  it("keeps the skip link and the main landmark contract", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "Saltar al contenido" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(within(main).getByTestId("child")).toBeInTheDocument();
  });
});

describe("AppShell brand logo", () => {
  it("renders the official Control Deck logo at 1:1 in the rail brand and the mobile header", () => {
    const { container } = renderShell();

    const logos = container.querySelectorAll('img[src="/logo.svg"]');
    expect(logos).toHaveLength(2);
    for (const logo of logos) {
      expect(logo.getAttribute("alt")).toBe("");
      // Aspect-ratio 1:1 containers: identical height and width sizing classes.
      const size = RegExp(/\bh-(\d+(?:\.\d+)?)\s+w-\1\b/).exec(logo.className);
      expect(size).not.toBeNull();
    }
    // Both tiles are square (h-N w-N) and exactly one keeps the rail glow.
    const tiles = Array.from(logos, (logo) => logo.parentElement!);
    for (const tile of tiles) {
      expect(/\bh-(\d+(?:\.\d+)?)\s+w-\1\b/.test(tile.className)).toBe(true);
    }
    expect(tiles.filter((tile) => tile.classList.contains("glow-cyan-sm"))).toHaveLength(1);
  });
});
