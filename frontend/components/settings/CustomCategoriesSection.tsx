"use client";

import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import DeckCard, { DeckEmptyState } from "@/components/dashboard/DeckCard";
import { ExpenseRowIcon } from "@/components/dashboard/icons";
import { deck } from "@/components/ui/deckStyles";
import { t } from "@/lib/i18n";
import { ApiError, serverMessage } from "@/lib/api/client";
import {
  createCategory,
  deleteCategory,
  useFinanceCategories,
} from "@/lib/api/finance";
import {
  CUSTOM_CATEGORIES_KEY,
  listCustomCategories,
  type CustomCategory,
} from "@/lib/settings/customCategories";

type MutateFn = ReturnType<typeof useSWRConfig>["mutate"];

/** Both sources must be revalidated: this section reads the finance-filtered
 * key while the Finanzas pickers/charts read the kind-free one. */
function revalidateCategorySources(mutate: MutateFn): void {
  void mutate("finance/categories-finance");
  void mutate("finance/categories");
}

/**
 * Custom categories manager (Configuración), backend-backed and finance-only.
 *
 * Reads `GET /categories?kind=finance` through the `finance/categories-finance`
 * SWR key; a row whose `kind` is not `finance` is never rendered, so the
 * Eliminar button can never target another module's category. Writes are
 * name-only `finance` rows (`POST /categories`, `DELETE /categories/{id}`).
 *
 * After create, delete and the legacy migration loop, both
 * `finance/categories-finance` (this section) and `finance/categories` (the
 * kind-free source of the Finanzas pickers/charts) are revalidated, so a
 * category created here still appears in the movement selects.
 *
 * One-time migration, resolved per row: rows left in the legacy
 * `pd-custom-categories` localStorage key are POSTed as `finance`. A row
 * that is created (201) or already exists (409) is dropped; a row the API
 * permanently rejects (422/VALIDATION_ERROR) is dropped and reported; any
 * other failure keeps the row in the key for a later mount to retry, so a
 * resolved row is never POSTed twice.
 */
export default function CustomCategoriesSection() {
  const { data, error: listError, isLoading } = useFinanceCategories();
  const { mutate } = useSWRConfig();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const migrated = useRef(false);

  useEffect(() => {
    if (migrated.current) return;
    migrated.current = true;
    const legacy = listCustomCategories();
    if (legacy.length === 0) return;
    (async () => {
      const pending: CustomCategory[] = [];
      let skipped = 0;
      for (const row of legacy) {
        try {
          await createCategory(row.name);
        } catch (err) {
          // A 409 means the name already exists server-side: migrated.
          if (err instanceof ApiError && err.status === 409) continue;
          // Permanently rejected: retrying can never succeed, so drop and count.
          if (
            err instanceof ApiError &&
            (err.status === 422 || err.code === "VALIDATION_ERROR")
          ) {
            skipped += 1;
            continue;
          }
          // Transient failure (network, 5xx, 401): keep it for a later mount.
          pending.push(row);
        }
      }
      try {
        if (pending.length === 0) {
          localStorage.removeItem(CUSTOM_CATEGORIES_KEY);
        } else {
          // Mirror the private v2 envelope owned by `customCategories.ts`.
          localStorage.setItem(
            CUSTOM_CATEGORIES_KEY,
            JSON.stringify({ v: 2, categories: pending }),
          );
        }
      } catch {
        // Private browsing: the next mount retries the migration.
      }
      if (skipped > 0) {
        setError(t("settings.categoriesMigrationSkipped", { count: skipped }));
      }
      revalidateCategorySources(mutate);
    })();
  }, [mutate]);

  async function handleCreate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t("finance.requiredFieldError"));
      return;
    }
    setCreating(true);
    try {
      await createCategory(name.trim());
      setName("");
      revalidateCategorySources(mutate);
    } catch (err) {
      setError(serverMessage(err, t("finance.saveFailed")));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!window.confirm(t("settings.confirmDeleteCategory"))) return;
    setError(null);
    setDeletingId(id);
    try {
      await deleteCategory(id);
      revalidateCategorySources(mutate);
    } catch (err) {
      setError(serverMessage(err, t("finance.deleteFailed")));
    } finally {
      setDeletingId((current) => (current === id ? null : current));
    }
  }

  // Defense in depth: even if a response slipped a non-finance row through,
  // its Eliminar button must never exist.
  const rows = (data ?? []).filter((row) => row.kind === "finance");
  const listFailed = listError
    ? serverMessage(listError, t("finance.loadFailed"))
    : null;

  return (
    <DeckCard title={t("settings.categoriesTitle")} hint={t("settings.categoriesHint")}>
      <form onSubmit={(e) => void handleCreate(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1.5">
          <span className={deck.fieldLabel}>{t("settings.categoryName")}</span>
          <input
            aria-label={t("settings.categoryName")}
            className={deck.fieldInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button type="submit" disabled={creating} className={deck.signalAction}>
          {creating ? t("finance.saving") : t("settings.createCategory")}
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-alert">
          {error}
        </p>
      ) : null}
      <div className="mt-4">
        {listFailed ? (
          <p role="alert" className="text-xs text-alert">
            {listFailed}
          </p>
        ) : isLoading ? (
          <p className="text-xs text-faint">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <DeckEmptyState
            icon={<ExpenseRowIcon className="h-5 w-5" />}
            title={t("settings.noCategories")}
            hint={t("settings.noCategoriesHint")}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className={deck.listRow}
              >
                <p className="truncate text-sm text-instrument">{row.name}</p>
                <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                  <button
                    type="button"
                    onClick={() => void handleDelete(row.id)}
                    disabled={deletingId === row.id}
                    aria-label={`${t("settings.delete")}: ${row.name}`}
                    className={deck.dangerAction}
                  >
                    {t("settings.delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DeckCard>
  );
}
