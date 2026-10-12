"use client";

import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import DeckCard, { DeckEmptyState } from "@/components/dashboard/DeckCard";
import { SubscriptionsIcon } from "@/components/dashboard/icons";
import { deck } from "@/components/ui/deckStyles";
import { t } from "@/lib/i18n";
import {
  createSubscription,
  patchSubscription,
  useFinanceCategories,
  useSubscriptions,
  type SubscriptionWire,
} from "@/lib/api/finance";
import { serverMessage } from "@/lib/api/client";
import {
  isPaidThisCycle,
  normalizeManualAmount,
  toCategoryOptions,
  todayInBogota,
  type NamedOption,
} from "@/lib/finance/finance";
import { formatMoney } from "@/lib/api/money";

const labelClass = "flex flex-col gap-1.5";

/** Real form field with the deck caption (label-caps) above it. */
function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`${labelClass} ${className ?? ""}`}>
      <span className={deck.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

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
 *
 * The category picker is finance-only, the same rule the categories section
 * uses (`useFinanceCategories()` → `GET /categories?kind=finance`) plus a
 * defensive `kind === "finance"` filter, so another module's category (a
 * habit, goal, task or subscription row) can never be selected here even if a
 * response slipped one through.
 */
export default function SubscriptionsSection() {
  const { mutate } = useSWRConfig();
  const subscriptions = useSubscriptions();
  const categories = useFinanceCategories();
  const [editingId, setEditingId] = useState<string | null>(null);

  const categoryOptions: NamedOption[] = useMemo(
    () =>
      toCategoryOptions(
        (categories.data ?? []).filter((row) => row.kind === "finance"),
      ),
    [categories.data],
  );
  const today = todayInBogota();

  async function revalidate(): Promise<void> {
    await mutate((key) => typeof key === "string" && key.startsWith("finance/"));
    await mutate((key) => typeof key === "string" && key.startsWith("dashboard/"));
  }

  if (subscriptions.error) {
    return (
      <DeckCard title={t("finance.subscriptionSettingsTitle")}>
        <p role="alert" className="text-sm text-alert">{t("finance.loadFailed")}</p>
        <button type="button" onClick={() => void subscriptions.mutate()} className={`mt-3 ${deck.headerAction}`}>
          {t("common.retry")}
        </button>
      </DeckCard>
    );
  }

  return (
    <DeckCard title={t("finance.subscriptionSettingsTitle")} hint={t("finance.subscriptionSettingsHint")}>
      <p className={deck.monoMicroLabel}>{t("finance.subscriptionMonthlyNote")}</p>

      <div className="flex flex-col gap-2">
        {subscriptions.isLoading ? (
          <p role="status" className="text-sm text-faint">{t("finance.loadingSections")}</p>
        ) : (subscriptions.data ?? []).length === 0 ? (
          <DeckEmptyState
            icon={<SubscriptionsIcon className="h-5 w-5" />}
            title={t("finance.noSubscriptions")}
            hint={t("finance.noSubscriptionsHint")}
          />
        ) : (
          (subscriptions.data ?? []).map((sub) => (
            <div key={sub.id} className={deck.cardRow}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-instrument">{sub.name}</p>
                  <p className="font-mono text-sm tabular-nums text-instrument">
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
                <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setEditingId(editingId === sub.id ? null : sub.id)}
                    aria-label={t("productivity.edit")}
                    className={deck.headerAction}
                  >
                    {t("productivity.edit")}
                  </button>
                </div>
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

      <div className="mt-4 border-t border-hair pt-4">
        <SubscriptionCreateForm categories={categoryOptions} onDone={() => void revalidate()} />
      </div>
    </DeckCard>
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
    <form aria-label={t("finance.subscriptionCreate")} className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => void handleSubmit(e)}>
      <Field label={t("finance.goalName")}>
        <input aria-label={t("finance.goalName")} className={deck.fieldInput} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("finance.price")}>
        <input aria-label={t("finance.price")} inputMode="decimal" placeholder={t("finance.amountPlaceholder")} className={deck.fieldInput} value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>
      <Field label={t("finance.subscriptionDueDate")}>
        <input aria-label={t("finance.subscriptionDueDate")} type="date" className={deck.fieldInput} value={nextBilling} onChange={(e) => setNextBilling(e.target.value)} />
      </Field>
      <Field label={t("finance.category")}>
        <select aria-label={t("finance.category")} className={deck.fieldInput} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">{t("finance.selectCategory")}</option>
          {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
      </Field>
      <Field label={t("finance.paymentMethod")} className="sm:col-span-2">
        <select aria-label={t("finance.paymentMethod")} className={deck.fieldInput} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
          <option value="">{t("finance.selectPaymentMethod")}</option>
          {PAYMENT_METHODS.map((m) => (<option key={m} value={m}>{paymentMethodLabel(m)}</option>))}
        </select>
      </Field>
      <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center sm:gap-3">
        <button type="submit" disabled={pending} className={`${deck.signalAction} w-full sm:w-auto`}>{pending ? t("finance.saving") : t("finance.subscriptionCreate")}</button>
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
    } catch (err) {
      setError(serverMessage(err, t("finance.saveFailed")));
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label={t("productivity.edit")} className="mt-3 grid grid-cols-1 gap-3 border-t border-hair pt-3 sm:grid-cols-2" onSubmit={(e) => void handleSubmit(e)}>
      <Field label={t("finance.goalName")}>
        <input aria-label={t("finance.goalName")} className={deck.fieldInput} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("finance.price")}>
        <input aria-label={t("finance.price")} inputMode="decimal" className={deck.fieldInput} value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>
      <Field label={t("finance.subscriptionDueDate")} className="sm:col-span-2">
        <input aria-label={t("finance.subscriptionDueDate")} type="date" className={deck.fieldInput} value={nextBilling} onChange={(e) => setNextBilling(e.target.value)} />
      </Field>
      <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center sm:gap-3">
        <button type="submit" disabled={pending} className={`${deck.signalAction} w-full sm:w-auto`}>{pending ? t("finance.saving") : t("finance.save")}</button>
        {error ? (<p role="alert" className="text-xs text-alert">{error}</p>) : null}
      </div>
    </form>
  );
}
