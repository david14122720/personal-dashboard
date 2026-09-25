"use client";

import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import {
  createCustomCategory,
  deleteCustomCategory,
  listCustomCategories,
  type CustomCategory,
} from "@/lib/settings/customCategories";

const inputClass =
  "w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument placeholder:text-instrument/40 focus:border-signal focus:outline-none";
const btnClass =
  "rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal disabled:opacity-50";

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
      className="rounded-xl border border-slate-800/80 bg-[#0f131d]/90 p-5"
    >
      <h2 className="font-display text-lg font-semibold tracking-wide">{t("settings.categoriesTitle")}</h2>
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
        <button type="submit" className={btnClass}>
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
          <div>
            <p className="text-sm font-medium">{t("settings.noCategories")}</p>
            <p className="mt-1 text-sm text-instrument/60">{t("settings.noCategoriesHint")}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-hull px-3 py-2"
              >
                <p className="truncate text-sm">{row.name}</p>
                <button
                  type="button"
                  onClick={() => handleDelete(row.id)}
                  aria-label={`${t("settings.delete")}: ${row.name}`}
                  className={btnClass}
                >
                  {t("settings.delete")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
