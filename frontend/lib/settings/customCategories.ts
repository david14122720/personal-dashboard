"use client";

/**
 * Custom finance categories owned by Configuración (P6).
 *
 * The backend only reads categories (`GET /categories`); there is no
 * create/delete endpoint, so user-defined categories live in localStorage
 * under `pd-custom-categories`. Finanzas merges them with the backend
 * `finance` categories for every classification select and chart, so a
 * category created in Configuración is immediately available in Finanzas.
 */

export type CustomCategoryKind = "gasto" | "ingreso";

export interface CustomCategory {
  id: string;
  name: string;
  kind: CustomCategoryKind;
}

export const CUSTOM_CATEGORIES_KEY = "pd-custom-categories";

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `cc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

/** Read every custom category (parse-safe: corrupt payloads read as empty). */
export function listCustomCategories(): CustomCategory[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(CUSTOM_CATEGORIES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is CustomCategory =>
        typeof row === "object" &&
        row !== null &&
        typeof (row as CustomCategory).id === "string" &&
        typeof (row as CustomCategory).name === "string" &&
        ((row as CustomCategory).kind === "gasto" || (row as CustomCategory).kind === "ingreso"),
    );
  } catch {
    return [];
  }
}

function persist(rows: CustomCategory[]): void {
  storage()?.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(rows));
}

/** Create a custom category (blank names are rejected with null). */
export function createCustomCategory(name: string, kind: CustomCategoryKind): CustomCategory | null {
  const trimmed = name.trim();
  if (!trimmed || (kind !== "gasto" && kind !== "ingreso")) return null;
  const row: CustomCategory = { id: newId(), name: trimmed, kind };
  persist([...listCustomCategories(), row]);
  return row;
}

/** Delete a custom category by id (unknown ids are a no-op). */
export function deleteCustomCategory(id: string): void {
  persist(listCustomCategories().filter((row) => row.id !== id));
}
