import { render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import CustomCategoriesSection from "@/components/settings/CustomCategoriesSection";
import {
  CUSTOM_CATEGORIES_KEY,
  listCustomCategories,
} from "@/lib/settings/customCategories";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

function category(id: string, name: string) {
  return {
    id,
    kind: "finance",
    name,
    color: null,
    icon: null,
    is_archived: false,
    created_at: "2026-01-01",
  };
}

/** Seed the legacy v2 envelope: name-only rows the section must migrate. */
function seedLegacy(names: string[]): void {
  localStorage.setItem(
    CUSTOM_CATEGORIES_KEY,
    JSON.stringify({
      v: 2,
      categories: names.map((name, index) => ({ id: `legacy-${index}`, name })),
    }),
  );
}

const posted: string[] = [];

const server = setupServer(
  http.get("http://test.local/api/categories", () => HttpResponse.json([])),
  http.post("http://test.local/api/categories", async ({ request }) => {
    const body = (await request.json()) as { name: string };
    posted.push(body.name);
    if (body.name === "Nueva") {
      return HttpResponse.json(category("c-new", "Nueva"), { status: 201 });
    }
    if (body.name === "Existente") {
      return HttpResponse.json(
        { error: { code: "CONFLICT", message: "ya existe una categoría con ese nombre" } },
        { status: 409 },
      );
    }
    if (body.name.startsWith("Rechazada")) {
      return HttpResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "el nombre de la categoría debe tener entre 1 y 80 caracteres",
          },
        },
        { status: 422 },
      );
    }
    return new HttpResponse("boom", { status: 500 });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
  posted.length = 0;
});
afterAll(() => server.close());

function Harness() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CustomCategoriesSection />
    </SWRConfig>
  );
}

function countPosted(name: string): number {
  return posted.filter((postedName) => postedName === name).length;
}

describe("CustomCategoriesSection legacy migration", () => {
  it("keeps only the pending row and reports the skipped count on mixed outcomes", async () => {
    seedLegacy(["Nueva", "Existente", "Rechazada A", "Rechazada B", "Transitoria"]);
    render(<Harness />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudieron migrar 2 categoría(s) guardadas",
    );
    await waitFor(() =>
      expect(listCustomCategories().map((row) => row.name)).toEqual(["Transitoria"]),
    );
    expect(posted).toEqual([
      "Nueva",
      "Existente",
      "Rechazada A",
      "Rechazada B",
      "Transitoria",
    ]);
  });

  it("removes the key when every row was created or already exists", async () => {
    seedLegacy(["Nueva", "Existente"]);
    render(<Harness />);

    await waitFor(() => expect(localStorage.getItem(CUSTOM_CATEGORIES_KEY)).toBeNull());
    expect(posted).toEqual(["Nueva", "Existente"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("drops a permanently rejected row, clears the key and reports it", async () => {
    seedLegacy(["Rechazada"]);
    render(<Harness />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudieron migrar 1 categoría(s) guardadas",
    );
    await waitFor(() => expect(localStorage.getItem(CUSTOM_CATEGORIES_KEY)).toBeNull());
    expect(posted).toEqual(["Rechazada"]);
  });

  it("never re-POSTs a row that already resolved on an earlier mount", async () => {
    seedLegacy(["Nueva", "Transitoria"]);
    const first = render(<Harness />);
    await waitFor(() => expect(countPosted("Transitoria")).toBe(1));
    await waitFor(() =>
      expect(listCustomCategories().map((row) => row.name)).toEqual(["Transitoria"]),
    );

    first.unmount();
    render(<Harness />);
    await waitFor(() => expect(countPosted("Transitoria")).toBe(2));
    expect(countPosted("Nueva")).toBe(1);
    await waitFor(() =>
      expect(listCustomCategories().map((row) => row.name)).toEqual(["Transitoria"]),
    );
  });
});
