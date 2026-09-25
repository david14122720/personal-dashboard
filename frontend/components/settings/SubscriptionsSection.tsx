"use client";

import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { t } from "@/lib/i18n";
import {
  createSubscription,
  patchSubscription,
  useCategories,
  useSubscriptions,
  type SubscriptionWire,
} from "@/lib/api/finance";
import {
  isPaidThisCycle,
  normalizeManualAmount,
  toCategoryOptions,
  todayInBogota,
  type NamedOption,
} from "@/lib/finance/finance";
import { formatMoney } from "@/lib/api/money";

const inputClass =
  "w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument placeholder:text-instrument/40 focus:border-signal focus:outline-none";
const btnClass =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:opacity-50";
const labelClass = "flex flex-col gap-1 text-xs text-instrument/60";

const PAYMENT_METHODS = ["efectivo", "débito", "transferencia", "tarjeta", "otro"] as const;

function paymentMethodLabel(value: string): string {
  switch (value) {
    case "efectivo":
      return t("finance.paymentCash");
    case "débito":
      return t("finance.paymentDebit");
    case "transferencia":
      return t("finance.paymentTransfer");
    case "tarjeta":
      return t("finance.paymentCard");
    default:
      return t("finance.paymentOther");
  }
}

/**
 * Subscription manager (Configuración → Ajustes). Create/edit live here, not
 * in Finance: name, price as a decimal string, required monthly due date
 * (`YYYY-MM-DD`), category by name and payment method. There is deliberately
 * NO frequency selector — every write is monthly-fixed and the create payload
 * omits `frequency` entirely. Edits send only widened-PATCH allowlisted
 * fields (`name|price|next_billing_on`); mutations refresh the `finance/`
 * SWR scope. Paid state is derived at render time via `isPaidThisCycle`.
 */
export default function SubscriptionsSection() {
  const { mutate } = useSWRConfig();
  const subscriptions = useSubscriptions();
  const categories = useCategories();
  const [editingId, setEditingId] = useState<string | null>(null);

  const categoryOptions: NamedOption[] = useMemo(
    () => toCategoryOptions(categories.data ?? []),
    [categories.data],
  );
  const today = todayInBogota();

  async function revalidate(): Promise<void> {
    await mutate((key) => typeof key === "string" && key.startsWith("finance/"));
    await mutate((key) => typeof key === "string" && key.startsWith("dashboard/"));
  }

  if (subscriptions.error) {
    return (
      <section aria-label={t("finance.subscriptionSettingsTitle")} className="rounded-xl border border-hull p-5">
        <h2 className="font-display text-lg font-semibold">{t("finance.subscriptionSettingsTitle")}</h2>
        <p role="alert" className="mt-2 text-sm text-alert">{t("finance.loadFailed")}</p>
        <button type="button" onClick={() => void subscriptions.mutate()} className={btnClass}>
          {t("common.retry")}
        </button>
      </section>
    );
  }

  return (
    <section aria-label={t("finance.subscriptionSettingsTitle")} className="rounded-xl border border-hull p-5">
      <h2 className="font-display text-lg font-semibold">{t("finance.subscriptionSettingsTitle")}</h2>
      <p className="mt-1 text-sm text-instrument/60">{t("finance.subscriptionSettingsHint")}</p>
      <p className="mt-1 text-xs text-instrument/60">{t("finance.subscriptionMonthlyNote")}</p>

      <div className="mt-4 flex flex-col gap-2">
        {subscriptions.isLoading ? (
          <p role="status" className="text-sm text-instrument/60">{t("finance.loadingSections")}</p>
        ) : (subscriptions.data ?? []).length === 0 ? (
          <p className="text-sm text-instrument/60">{t("finance.noSubscriptionsHint")}</p>
        ) : (
          (subscriptions.data ?? []).map((sub) => (
            <div key={sub.id} className="rounded-lg border border-hull px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{sub.name}</p>
                  <p className="font-mono text-sm tabular-nums">
                    {formatMoney(sub.price, { currency: sub.currency ?? "COP" })}
                    {sub.next_billing_on ? ` · ${sub.next_billing_on}` : null}
                  </p>
                  {isPaidThisCycle(
                    { last_paid_on: sub.last_paid_on ?? null, next_billing_on: sub.next_billing_on },
                    today,
                  ) ? (
                    <p className="mt-0.5 text-xs text-signal">{t("finance.paidThisCycle")}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setEditingId(editingId === sub.id ? null : sub.id)}
                  aria-label={t("productivity.edit")}
                  className={btnClass}
                >
                  {t("productivity.edit")}
                </button>
              </div>
              {editingId === sub.id ? (
                <SubscriptionEditForm
                  sub={sub}
                  onDone={() => {
                    setEditingId(null);
                    void revalidate();
                  }}
                />
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="mt-4 border-t border-hull pt-4">
        <SubscriptionCreateForm categories={categoryOptions} onDone={() => void revalidate()} />
      </div>
    </section>
  );
}

/** Create form: monthly-fixed, no frequency field anywhere in sight. */
export function SubscriptionCreateForm({
  categories,
  onDone,
}: {
  categories: NamedOption[];
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [nextBilling, setNextBilling] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const wirePrice = normalizeManualAmount(price);
    if (!name.trim()) {
      setError(t("finance.requiredFieldError"));
      return;
    }
    if (wirePrice === null) {
      setError(t("finance.amountPositiveError"));
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextBilling.trim())) {
      setError(t("finance.subscriptionDueRequired"));
      return;
    }
    setPending(true);
    try {
      // Monthly-fixed: no `frequency` field is sent at all.
      await createSubscription({
        name: name.trim(),
        price: wirePrice,
        currency: "COP",
        next_billing_on: nextBilling.trim(),
        ...(categoryId ? { category_id: categoryId } : {}),
        ...(paymentMethod ? { payment_method: paymentMethod } : {}),
      });
      setName("");
      setPrice("");
      setNextBilling("");
      setCategoryId("");
      setPaymentMethod("");
      onDone();
    } catch {
      setError(t("finance.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label={t("finance.subscriptionCreate")} className="grid grid-cols-2 gap-3" onSubmit={(e) => void handleSubmit(e)}>
      <label className={labelClass}>
        {t("finance.goalName")}
        <input aria-label={t("finance.goalName")} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className={labelClass}>
        {t("finance.price")}
        <input aria-label={t("finance.price")} inputMode="decimal" placeholder={t("finance.amountPlaceholder")} className={inputClass} value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      <label className={labelClass}>
        {t("finance.subscriptionDueDate")}
        <input aria-label={t("finance.subscriptionDueDate")} type="date" className={inputClass} value={nextBilling} onChange={(e) => setNextBilling(e.target.value)} />
      </label>
      <label className={labelClass}>
        {t("finance.category")}
        <select aria-label={t("finance.category")} className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">{t("finance.selectCategory")}</option>
          {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
      </label>
      <label className={`${labelClass} col-span-2`}>
        {t("finance.paymentMethod")}
        <select aria-label={t("finance.paymentMethod")} className={inputClass} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
          <option value="">{t("finance.selectPaymentMethod")}</option>
          {PAYMENT_METHODS.map((m) => (<option key={m} value={m}>{paymentMethodLabel(m)}</option>))}
        </select>
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button type="submit" disabled={pending} className={btnClass}>{pending ? t("finance.saving") : t("finance.subscriptionCreate")}</button>
        {error ? (<p role="alert" className="text-xs text-alert">{error}</p>) : null}
      </div>
    </form>
  );
}

/** Edit form: only the widened-PATCH allowlist (`name|price|next_billing_on`). */
export function SubscriptionEditForm({
  sub,
  onDone,
}: {
  sub: SubscriptionWire;
  onDone: () => void;
}) {
  const [name, setName] = useState(sub.name);
  const [price, setPrice] = useState(String(sub.price));
  const [nextBilling, setNextBilling] = useState(sub.next_billing_on ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const wirePrice = normalizeManualAmount(price);
    if (!name.trim()) {
      setError(t("finance.requiredFieldError"));
      return;
    }
    if (wirePrice === null) {
      setError(t("finance.amountPositiveError"));
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextBilling.trim())) {
      setError(t("finance.subscriptionDueRequired"));
      return;
    }
    setPending(true);
    try {
      // Allowlisted fields only — `frequency`, `currency`, `category_id`,
      // `payment_method` and friends stay server-rejected.
      await patchSubscription(sub.id, {
        name: name.trim(),
        price: wirePrice,
        next_billing_on: nextBilling.trim(),
      });
      onDone();
    } catch {
      setError(t("finance.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label={t("productivity.edit")} className="mt-3 grid grid-cols-2 gap-3 border-t border-hull pt-3" onSubmit={(e) => void handleSubmit(e)}>
      <label className={labelClass}>
        {t("finance.goalName")}
        <input aria-label={t("finance.goalName")} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className={labelClass}>
        {t("finance.price")}
        <input aria-label={t("finance.price")} inputMode="decimal" className={inputClass} value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      <label className={`${labelClass} col-span-2`}>
        {t("finance.subscriptionDueDate")}
        <input aria-label={t("finance.subscriptionDueDate")} type="date" className={inputClass} value={nextBilling} onChange={(e) => setNextBilling(e.target.value)} />
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button type="submit" disabled={pending} className={btnClass}>{pending ? t("finance.saving") : t("finance.save")}</button>
        {error ? (<p role="alert" className="text-xs text-alert">{error}</p>) : null}
      </div>
    </form>
  );
}
