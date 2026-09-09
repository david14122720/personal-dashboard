"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { t } from "@/lib/i18n";
import { createBudget, deleteBudget, patchBudget } from "@/lib/api/finance";
import { normalizeManualAmount, type NamedOption } from "@/lib/finance/finance";

const inputClass =
  "w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument placeholder:text-instrument/40 focus:border-signal focus:outline-none";
const btnClass =
  "rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal disabled:opacity-50";

export interface BudgetFormValue {
  id: string;
  category_id: string;
  amount: string | number;
  period_start: string;
  period_end: string;
  warn_threshold?: number | null;
  over_threshold?: number | null;
  notes?: string | null;
}

/** Crear + editar presupuesto (editar = PATCH allowlist real). Montos a mano, categoría por nombre. */
export default function BudgetForm({
  categories,
  budget,
  onDone,
}: {
  categories: NamedOption[];
  budget?: BudgetFormValue;
  onDone: () => void;
}) {
  const { mutate } = useSWRConfig();
  const [categoryId, setCategoryId] = useState(budget?.category_id ?? "");
  const [amount, setAmount] = useState(String(budget?.amount ?? ""));
  const [from, setFrom] = useState(budget?.period_start ?? "");
  const [to, setTo] = useState(budget?.period_end ?? "");
  const [warn, setWarn] = useState(String(budget?.warn_threshold ?? 0.8));
  const [over, setOver] = useState(String(budget?.over_threshold ?? 1.0));
  const [notes, setNotes] = useState(budget?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const wireAmount = normalizeManualAmount(amount);
    const w = Number(warn);
    const o = Number(over);
    if (!wireAmount || !categoryId || !from || !to || !(w >= 0 && w <= 2) || !(o >= 0 && o <= 2)) {
      setError(!wireAmount ? t("finance.amountPositiveError") : t("finance.requiredFieldError"));
      return;
    }
    setPending(true);
    try {
      const body = { category_id: categoryId, amount: wireAmount, period_start: from, period_end: to, warn_threshold: w, over_threshold: o, ...(notes.trim() ? { notes: notes.trim() } : {}) };
      if (budget) await patchBudget(budget.id, body);
      else await createBudget(body);
      await mutate("dashboard/budgets");
      onDone();
    } catch {
      setError(t("finance.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!budget || !window.confirm(t("finance.confirmDeleteBudget"))) return;
    setPending(true);
    try {
      await deleteBudget(budget.id);
      await mutate("dashboard/budgets");
      onDone();
    } catch {
      setError(t("finance.deleteFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label={t("finance.budgets")} className="grid grid-cols-2 gap-3" onSubmit={(e) => void handleSubmit(e)}>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.category")}
        <select aria-label={t("finance.category")} className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">{t("finance.selectCategory")}</option>
          {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.amountCop")}
        <input aria-label={t("finance.amountCop")} inputMode="decimal" placeholder={t("finance.amountPlaceholder")} className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.from")}
        <input aria-label={t("finance.from")} type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.to")}
        <input aria-label={t("finance.to")} type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.warnThreshold")}
        <input aria-label={t("finance.warnThreshold")} inputMode="decimal" className={inputClass} value={warn} onChange={(e) => setWarn(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.overThreshold")}
        <input aria-label={t("finance.overThreshold")} inputMode="decimal" className={inputClass} value={over} onChange={(e) => setOver(e.target.value)} />
      </label>
      <label className="col-span-2 flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.description")}
        <input aria-label={t("finance.description")} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button type="submit" disabled={pending} className={btnClass}>{pending ? t("finance.saving") : t("productivity.save")}</button>
        {budget ? (<button type="button" disabled={pending} onClick={() => void handleDelete()} className={btnClass}>{t("productivity.delete")}</button>) : null}
        {error ? (<p role="alert" className="text-xs text-alert">{error}</p>) : null}
      </div>
    </form>
  );
}
