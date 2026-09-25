import { beforeEach, describe, expect, it } from "vitest";
import {
  createCustomCategory,
  CUSTOM_CATEGORIES_KEY,
  deleteCustomCategory,
  listCustomCategories,
} from "./customCategories";

beforeEach(() => {
  localStorage.clear();
});

describe("customCategories (v2, kind-free)", () => {
  it("creates categories without kind and round-trips the v2 envelope", () => {
    expect(listCustomCategories()).toEqual([]);
    const food = createCustomCategory("Comida");
    const salary = createCustomCategory("Sueldo");
    expect(food).not.toBeNull();
    expect(salary).not.toBeNull();
    expect(listCustomCategories().map((c) => c.name)).toEqual(["Comida", "Sueldo"]);
    const stored = JSON.parse(localStorage.getItem(CUSTOM_CATEGORIES_KEY) ?? "{}");
    expect(stored.v).toBe(2);
    expect(stored.categories).toEqual([
      { id: food?.id, name: "Comida" },
      { id: salary?.id, name: "Sueldo" },
    ]);
  });

  it("migrates legacy kind-ful arrays losslessly (ids/names survive, kind dropped)", () => {
    localStorage.setItem(
      CUSTOM_CATEGORIES_KEY,
      JSON.stringify([
        { id: "a", name: "Comida", kind: "gasto" },
        { id: "b", name: "Sueldo", kind: "ingreso" },
      ]),
    );
    expect(listCustomCategories()).toEqual([
      { id: "a", name: "Comida" },
      { id: "b", name: "Sueldo" },
    ]);
    const stored = JSON.parse(localStorage.getItem(CUSTOM_CATEGORIES_KEY) ?? "{}");
    expect(stored).toEqual({
      v: 2,
      categories: [
        { id: "a", name: "Comida" },
        { id: "b", name: "Sueldo" },
      ],
    });
  });

  it("rejects blank names and drops malformed rows", () => {
    expect(createCustomCategory("   ")).toBeNull();
    expect(listCustomCategories()).toEqual([]);
    localStorage.setItem(
      CUSTOM_CATEGORIES_KEY,
      JSON.stringify([{ id: "a", name: "Ok", kind: "gasto" }, { id: 1, name: null }]),
    );
    expect(listCustomCategories()).toEqual([{ id: "a", name: "Ok" }]);
  });

  it("deletes by id and tolerates corrupt payloads", () => {
    const row = createCustomCategory("Comida");
    deleteCustomCategory("missing-id");
    expect(listCustomCategories()).toHaveLength(1);
    deleteCustomCategory(row?.id ?? "");
    expect(listCustomCategories()).toEqual([]);
    localStorage.setItem(CUSTOM_CATEGORIES_KEY, "not-json{{{");
    expect(listCustomCategories()).toEqual([]);
  });
});
