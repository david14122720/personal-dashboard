"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { t } from "@/lib/i18n";
import { createSubscription, deleteSubscription, setSubscriptionActive, type SubscriptionWire } from "@/lib/api/finance";
import { normalizeManualAmount, type NamedOption } from "@/lib/finance/finance";

const inputClass =
  "w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument placeholder:text-instrument/40 focus:border-signal focus:outline-none";
const btnClass =
  "rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal disabled:opacity-50";

const FREQUENCIES = ["daily", "weekly", "biweekly", "monthly", "quarterly", "semiannual", "annual"];

/** Crear suscripción manual en COP (currency fija COP, frecuencia enum real del BE). */
export function SubscriptionCreateForm({
  categories, onDone,
}: { categories: NamedOption[]; onDone: () => void }) {
  const { mutate } = useSWRConfig();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [frequency, setFrequency] = useState("monthly");
  const [nextBilling, setNextBilling] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const wirePrice = normalizeManualAmount(price);
    if (!name.trim() || !wirePrice) { setError(!wirePrice ? t("finance.amountPositiveError") : t("finance.requiredFieldError")); return; }
    setPending(true);
    try {
      await createSubscription({ name: name.trim(), price: wirePrice, currency: "COP", frequency, ...(nextBilling ? { next_billing_on: nextBilling } : {}), ...(categoryId ? { category_id: categoryId } : {}), ...(paymentMethod ? { payment_method: paymentMethod } : {}), ...(url.trim() ? { url: url.trim() } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) });
      await mutate("finance/subscriptions");
      await mutate("dashboard/subscriptions");
      onDone();
    } catch {
      setError(t("finance.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label={t("finance.subscriptions")} className="grid grid-cols-2 gap-3" onSubmit={(e) => void handleSubmit(e)}>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.goalName")}
        <input aria-label={t("finance.goalName")} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.price")}
        <input aria-label={t("finance.price")} inputMode="decimal" placeholder={t("finance.amountPlaceholder")} className={inputClass} value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.frequency")}
        <select aria-label={t("finance.frequency")} className={inputClass} value={frequency} onChange={(e) => setFrequency(e.target.value)}>
          {FREQUENCIES.map((f) => (<option key={f} value={f}>{f}</option>))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.dateLabel")}
        <input aria-label={t("finance.dateLabel")} type="date" className={inputClass} value={nextBilling} onChange={(e) => setNextBilling(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.category")}
        <select aria-label={t("finance.category")} className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">{t("finance.selectCategory")}</option>
          {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.paymentMethod")}
        <select aria-label={t("finance.paymentMethod")} className={inputClass} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
          <option value="">{t("finance.selectPaymentMethod")}</option>
          <option value="efectivo">{t("finance.paymentCash")}</option>
          <option value="débito">{t("finance.paymentDebit")}</option>
          <option value="transferencia">{t("finance.paymentTransfer")}</option>
          <option value="tarjeta">{t("finance.paymentCard")}</option>
          <option value="otro">{t("finance.paymentOther")}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.url")}
        <input aria-label={t("finance.url")} className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.description")}
        <input aria-label={t("finance.description")} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button type="submit" disabled={pending} className={btnClass}>{pending ? t("finance.saving") : t("finance.createSub")}</button>
        {error ? (<p role="alert" className="text-xs text-alert">{error}</p>) : null}
      </div>
    </form>
  );
}

/** Fila con cancelar/reactivar (PATCH solo {is_active}) + borrar con confirmación. */
export function SubscriptionRow({ sub }: { sub: SubscriptionWire }) {
  const { mutate } = useSWRConfig();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function revalidate(): Promise<void> {
    await mutate("finance/subscriptions");
    await mutate("dashboard/subscriptions");
  }

  async function toggle(): Promise<void> {
    setPending(true);
    try {
      await setSubscriptionActive(sub.id, !sub.is_active);
      await revalidate();
    } catch {
      setError(t("finance.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm(t("finance.confirmDeleteSub"))) return;
    setPending(true);
    try {
      await deleteSubscription(sub.id);
      await revalidate();
    } catch {
      setError(t("finance.deleteFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-hull px-3 py-2">
      <p className="truncate text-sm">{sub.name}</p>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" disabled={pending} onClick={() => void toggle()} className={btnClass}>{sub.is_active ? t("finance.cancelSub") : t("finance.reactivateSub")}</button>
        <button type="button" disabled={pending} onClick={() => void remove()} className={btnClass}>{t("productivity.delete")}</button>
      </div>
      {error ? (<p role="alert" className="text-xs text-alert">{error}</p>) : null}
    </div>
  );
}
