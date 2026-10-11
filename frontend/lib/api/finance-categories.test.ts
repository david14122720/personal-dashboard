import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createCategory, deleteCategory } from "./finance";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const seen: { method: string; path: string; body: unknown }[] = [];

const server = setupServer(
  http.post("http://test.local/api/categories", async ({ request }) => {
    seen.push({ method: "POST", path: "/categories", body: await request.json() });
    return HttpResponse.json(
      { id: "c1", kind: "finance", name: "Mercado", color: null, icon: null, is_archived: false },
      { status: 201 },
    );
  }),
  http.delete("http://test.local/api/categories/:id", ({ params }) => {
    seen.push({ method: "DELETE", path: `/categories/${params.id}`, body: null });
    return new HttpResponse(null, { status: 204 });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seen.length = 0;
});
afterAll(() => server.close());

describe("category create/delete", () => {
  it("createCategory posts the finance kind with the trimmed name", async () => {
    const created = await createCategory("Mercado");
    expect(created).toMatchObject({ id: "c1", kind: "finance", name: "Mercado" });
    expect(seen).toEqual([
      { method: "POST", path: "/categories", body: { name: "Mercado", kind: "finance" } },
    ]);
  });

  it("deleteCategory deletes the category by id", async () => {
    await deleteCategory("c1");
    expect(seen).toEqual([{ method: "DELETE", path: "/categories/c1", body: null }]);
  });
});
