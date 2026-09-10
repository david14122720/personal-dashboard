"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { t } from "@/lib/i18n";
import { apiDelete, apiPost } from "@/lib/api/client";
import { createMovement, patchGoal } from "@/lib/api/finance";
import { toNumber } from "@/lib/api/money";
import { normalizeManualAmount, type NamedOption } from "@/lib/finance/finance";

const inputClass =
  "w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument placeholder:text-instrument/40 focus:border-signal focus:outline-none";
const btnClass =
  "rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal disabled:opacity-50";

function revalidate(mutate: ReturnType<typeof useSWRConfig>["mutate"]): Promise<unknown> {
  return mutate(
    (key) => typeof key === "string" && (key === "finance/savings-goals" || key === "dashboard/savings-goals"),
  );
}

/** Abonar/retirar con monto firmado; bloquea sobrerretiro en cliente (el 422 BE manda). */
export function SavingsDepositForm({
  goalId, saved, currency, onDone,
}: { goalId: string; saved: number; currency: string; onDone: () => void }) {
  const { mutate } = useSWRConfig();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(signed: string): Promise<void> {
    setError(null);
    const wire = normalizeManualAmount(amount);
    if (!wire) { setError(t("finance.amountPositiveError")); return; }
    if (signed.startsWith("-") && toNumber(wire) > saved) { setError(t("finance.overWithdrawal")); return; }
    setPending(true);
    try {
      await createMovement(goalId, { amount: `${signed.startsWith("-") ? "-" : ""}${wire}`, occurred_on: new Date().toISOString().slice(0, 10) });
      setAmount("");
      await revalidate(mutate);
      onDone();
    } catch {
      setError(t("finance.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label={t("finance.savings")} className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); void submit(""); }}>
      <label className="col-span-2 flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.amountCop")}
        <input aria-label={t("finance.amountCop")} inputMode="decimal" placeholder={t("finance.amountPlaceholder")} className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button type="button" disabled={pending} onClick={() => void submit("")} className={btnClass}>{t("finance.deposit")}</button>
        <button type="button" disabled={pending} onClick={() => void submit("-")} className={btnClass}>{t("finance.withdraw")}</button>
        {error ? (<p role="alert" className="text-xs text-alert">{error}</p>) : null}
      </div>
    </form>
  );
}

/** Crear + editar meta (allowlist PATCH real); eliminar con confirmación. */
export function SavingsGoalForm({
  categories, goal, onDone,
}: { categories: NamedOption[]; goal?: { id: string; name: string; description?: string | null; target_amount: string | number; target_date?: string | null; category_id?: string | null; color?: string | null }; onDone: () => void }) {
  const { mutate } = useSWRConfig();
  const [name, setName] = useState(goal?.name ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [target, setTarget] = useState(String(goal?.target_amount ?? ""));
  const [targetDate, setTargetDate] = useState(goal?.target_date ?? "");
  const [categoryId, setCategoryId] = useState(goal?.category_id ?? "");
  const [color, setColor] = useState(goal?.color ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const wire = normalizeManualAmount(target);
    if (!name.trim() || !wire) { setError(!wire ? t("finance.amountPositiveError") : t("finance.requiredFieldError")); return; }
    setPending(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), target_amount: wire, ...(description.trim() ? { description: description.trim() } : {}), ...(targetDate ? { target_date: targetDate } : {}), ...(categoryId ? { category_id: categoryId } : {}), ...(color.trim() ? { color: color.trim() } : {}) };
      if (goal) await patchGoal(goal.id, body);
      else await apiPost("/savings-goals", body);
      await revalidate(mutate);
      onDone();
    } catch {
      setError(t("finance.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!goal || !window.confirm(t("finance.confirmDeleteGoal"))) return;
    setPending(true);
    try {
      await apiDelete(`/savings-goals/${goal.id}`);
      await revalidate(mutate);
      onDone();
    } catch {
      setError(t("finance.deleteFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label={t("finance.savings")} className="grid grid-cols-2 gap-3" onSubmit={(e) => void handleSubmit(e)}>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.goalName")}
        <input aria-label={t("finance.goalName")} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.amountCop")}
        <input aria-label={t("finance.amountCop")} inputMode="decimal" className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.dateLabel")}
        <input aria-label={t("finance.dateLabel")} type="date" className={inputClass} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.category")}
        <select aria-label={t("finance.category")} className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">{t("finance.selectCategory")}</option>
          {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.description")}
        <input aria-label={t("finance.description")} className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.color")}
        <input aria-label={t("finance.color")} className={inputClass} value={color} onChange={(e) => setColor(e.target.value)} />
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button type="submit" disabled={pending} className={btnClass}>{pending ? t("finance.saving") : t("productivity.save")}</button>
        {goal ? (<button type="button" disabled={pending} onClick={() => void handleDelete()} className={btnClass}>{t("productivity.delete")}</button>) : null}
        {error ? (<p role="alert" className="text-xs text-alert">{error}</p>) : null}
      </div>
    </form>
  );
}

