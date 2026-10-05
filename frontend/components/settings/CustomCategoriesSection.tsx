"use client";

import { useEffect, useState } from "react";
import EmptyState from "@/components/ui/EmptyState";
import { t } from "@/lib/i18n";
import {
  createCustomCategory,
  deleteCustomCategory,
  listCustomCategories,
  type CustomCategory,
} from "@/lib/settings/customCategories";

const inputClass =
  "min-h-11 w-full rounded-md border border-hull bg-deck px-3 text-sm text-instrument transition-colors placeholder:text-slate-500 focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/30";
const primaryBtnClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-signal px-4 font-display text-sm font-semibold text-deck transition-colors hover:bg-signal-soft disabled:cursor-not-allowed disabled:opacity-50";
const dangerBtnClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-hull px-3 font-display text-sm text-instrument-dim transition-colors hover:border-alert hover:text-alert disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Custom categories manager (Configuración). Categories are name-only and
 * stay localStorage-only: their ids are unknown to the API, so movement
 * and subscription selects never list them.
 */
export default function CustomCategoriesSection() {
  const [rows, setRows] = useState<CustomCategory[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(listCustomCategories());
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === "pd-custom-categories") {
        setRows(listCustomCategories());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function handleCreate(event: React.FormEvent): void {
    event.preventDefault();
    setError(null);
    const created = createCustomCategory(name);
    if (!created) {
      setError(t("finance.requiredFieldError"));
      return;
    }
    setName("");
    setRows(listCustomCategories());
  }

  function handleDelete(id: string): void {
    if (!window.confirm(t("settings.confirmDeleteCategory"))) return;
    deleteCustomCategory(id);
    setRows(listCustomCategories());
  }

  return (
    <section
      aria-label={t("settings.categoriesTitle")}
      className="rounded-xl border border-hull bg-panel/90 p-4 sm:p-5"
    >
      <h2 className="font-display text-base font-medium tracking-wide">{t("settings.categoriesTitle")}</h2>
      <p className="mt-1 text-xs text-slate-400">{t("settings.categoriesHint")}</p>
      <form onSubmit={handleCreate} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-xs text-instrument/60">
          {t("settings.categoryName")}
          <input
            aria-label={t("settings.categoryName")}
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button type="submit" className={primaryBtnClass}>
          {t("settings.createCategory")}
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-alert">
          {error}
        </p>
      ) : null}
      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState title={t("settings.noCategories")} hint={t("settings.noCategoriesHint")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-3 rounded-lg border border-hull px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="truncate text-sm">{row.name}</p>
                <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                  <button
                    type="button"
                    onClick={() => handleDelete(row.id)}
                    aria-label={`${t("settings.delete")}: ${row.name}`}
                    className={dangerBtnClass}
                  >
                    {t("settings.delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
