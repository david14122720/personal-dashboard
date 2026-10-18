import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import CustomCategoriesSection from "@/components/settings/CustomCategoriesSection";
import { useCategories, type CategoryWire } from "@/lib/api/finance";
import {
  CUSTOM_CATEGORIES_KEY,
  listCustomCategories,
} from "@/lib/settings/customCategories";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

function category(id: string, name: string, kind = "finance"): CategoryWire {
  return {
    id,
    kind,
    name,
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

/** In-memory store for the stateful handlers, reset between tests. MSW v2
 * matches by pathname only (`getCleanUrl` drops the query string), so one
 * handler serves both `/categories` (consumer) and `/categories?kind=finance`
 * (section); it filters only when `kind` is present. */
const categories: CategoryWire[] = [];
const categoryRequests: string[] = [];

const server = setupServer(
  http.get("http://test.local/api/categories", ({ request }) => {
    categoryRequests.push(request.url);
    const kind = new URL(request.url).searchParams.get("kind");
    return HttpResponse.json(
      kind ? categories.filter((row) => row.kind === kind) : categories,
    );
  }),
  http.post("http://test.local/api/categories", async ({ request }) => {
    const body = (await request.json()) as { name: string };
    posted.push(body.name);
    if (body.name === "Nueva") {
      const row = category("c-new", "Nueva");
      categories.push(row);
      return HttpResponse.json(row, { status: 201 });
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
  categories.length = 0;
  categoryRequests.length = 0;
});
afterAll(() => server.close());

function Harness() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CustomCategoriesSection />
    </SWRConfig>
  );
}

/** Kind-free consumer mounted under the same SWR provider: proves the section
 * also revalidates `finance/categories`, the source of the Finanzas
 * pickers/charts. */
function KindFreeConsumer() {
  const { data } = useCategories();
  return (
    <section aria-label="Consumidor sin filtro">
      <ul>
        {(data ?? []).map((row) => (
          <li key={row.id}>{row.name}</li>
        ))}
      </ul>
    </section>
  );
}

function SharedHarness() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CustomCategoriesSection />
      <KindFreeConsumer />
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

describe("CustomCategoriesSection finance-only", () => {
  it("reads only finance categories (GET /categories?kind=finance)", async () => {
    render(<Harness />);

    await waitFor(() => expect(categoryRequests.length).toBeGreaterThan(0));
    expect(
      categoryRequests.every(
        (url) => new URL(url).searchParams.get("kind") === "finance",
      ),
    ).toBe(true);
  });

  it("never renders a non-finance row even when the response contains one", async () => {
    server.use(
      http.get("http://test.local/api/categories", () =>
        HttpResponse.json([
          category("c-fin", "Comida"),
          category("c-habit", "Salud", "habit"),
        ]),
      ),
    );
    render(<Harness />);

    expect(await screen.findByText("Comida")).toBeInTheDocument();
    expect(screen.queryByText("Salud")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Eliminar: Salud" }),
    ).not.toBeInTheDocument();
  });

  it("revalidates finance/categories so a mounted kind-free consumer sees the create", async () => {
    render(<SharedHarness />);
    const consumer = await screen.findByRole("region", { name: "Consumidor sin filtro" });

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Nueva" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear categoría" }));

    await waitFor(() => expect(within(consumer).getByText("Nueva")).toBeInTheDocument());
  });
});
