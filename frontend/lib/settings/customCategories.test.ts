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

describe("customCategories", () => {
  it("creates gasto/ingreso categories and lists them", () => {
    expect(listCustomCategories()).toEqual([]);
    const food = createCustomCategory("Comida", "gasto");
    const salary = createCustomCategory("Sueldo", "ingreso");
    expect(food).not.toBeNull();
    expect(salary).not.toBeNull();
    expect(listCustomCategories().map((c) => c.name)).toEqual(["Comida", "Sueldo"]);
  });

  it("rejects blank names and unknown kinds", () => {
    expect(createCustomCategory("   ", "gasto")).toBeNull();
    expect(createCustomCategory("X", "otro" as never)).toBeNull();
    expect(listCustomCategories()).toEqual([]);
  });

  it("deletes by id and tolerates corrupt payloads", () => {
    const row = createCustomCategory("Comida", "gasto");
    deleteCustomCategory("missing-id");
    expect(listCustomCategories()).toHaveLength(1);
    deleteCustomCategory(row?.id ?? "");
    expect(listCustomCategories()).toEqual([]);
    localStorage.setItem(CUSTOM_CATEGORIES_KEY, "not-json{{{");
    expect(listCustomCategories()).toEqual([]);
  });
});
