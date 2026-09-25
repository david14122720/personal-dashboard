"use client";

/**
 * Custom finance categories owned by Configuración.
 *
 * The backend only reads categories (`GET /categories`); there is no
 * create/delete endpoint, so user-defined categories live in localStorage
 * under `pd-custom-categories` as a versioned envelope
 * `{ v: 2, categories: [{ id, name }] }`. Customs stay localStorage-only:
 * their ids are unknown to the API, so the movement and subscription
 * selects (which persist `category_id`) never list them — the section copy
 * says so honestly.
 */

export interface CustomCategory {
  id: string;
  name: string;
}

export const CUSTOM_CATEGORIES_KEY = "pd-custom-categories";

const CUSTOM_CATEGORIES_VERSION = 2;

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

function isNamedRow(row: unknown): row is { id: string; name: string } {
  return (
    typeof row === "object" &&
    row !== null &&
    typeof (row as { id: unknown }).id === "string" &&
    typeof (row as { name: unknown }).name === "string"
  );
}

function persist(rows: CustomCategory[]): void {
  storage()?.setItem(
    CUSTOM_CATEGORIES_KEY,
    JSON.stringify({ v: CUSTOM_CATEGORIES_VERSION, categories: rows }),
  );
}

/** Read every custom category (parse-safe: corrupt payloads read as empty).
 * Accepts the legacy v1 bare-array shape (`{ id, name, kind }`) and migrates
 * it in place: ids/names preserved, `kind` dropped, v2 written back. */
export function listCustomCategories(): CustomCategory[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(CUSTOM_CATEGORIES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const rows = parsed
        .filter(isNamedRow)
        .map(({ id, name }) => ({ id, name }));
      persist(rows);
      return rows;
    }
    if (typeof parsed === "object" && parsed !== null) {
      const envelope = parsed as { v?: unknown; categories?: unknown };
      if (
        envelope.v === CUSTOM_CATEGORIES_VERSION &&
        Array.isArray(envelope.categories)
      ) {
        return envelope.categories
          .filter(isNamedRow)
          .map(({ id, name }) => ({ id, name }));
      }
    }
    return [];
  } catch {
    return [];
  }
}

/** Create a custom category (blank names are rejected with null). */
export function createCustomCategory(name: string): CustomCategory | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const row: CustomCategory = { id: newId(), name: trimmed };
  persist([...listCustomCategories(), row]);
  return row;
}

/** Delete a custom category by id (unknown ids are a no-op). */
export function deleteCustomCategory(id: string): void {
  persist(listCustomCategories().filter((row) => row.id !== id));
}
