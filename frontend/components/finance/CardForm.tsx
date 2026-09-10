"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { t } from "@/lib/i18n";
import { createCard } from "@/lib/api/finance";
import { normalizeManualAmount } from "@/lib/finance/finance";

const inputClass =
  "w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument placeholder:text-instrument/40 focus:border-signal focus:outline-none";
const btnClass =
  "rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal disabled:opacity-50";

/** Crear tarjeta sobre POST /accounts type=credit_card; exige límite + ambos días (espejo BE). */
export default function CardForm({ onDone }: { onDone: () => void }) {
  const { mutate } = useSWRConfig();
  const [name, setName] = useState("");
  const [limit, setLimit] = useState("");
  const [statementDay, setStatementDay] = useState("");
  const [paymentDueDay, setPaymentDueDay] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const wireLimit = normalizeManualAmount(limit);
    const cut = Number(statementDay);
    const due = Number(paymentDueDay);
    if (!name.trim() || !wireLimit || !(cut >= 1 && cut <= 31) || !(due >= 1 && due <= 31)) {
      setError(!wireLimit ? t("finance.amountPositiveError") : t("finance.requiredFieldError"));
      return;
    }
    setPending(true);
    try {
      await createCard({ name: name.trim(), currency: "COP", credit_limit: wireLimit, statement_day: cut, payment_due_day: due });
      await mutate("dashboard/accounts");
      await mutate("dashboard/net-worth");
      onDone();
    } catch {
      setError(t("finance.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label={t("finance.accounts")} className="grid grid-cols-2 gap-3" onSubmit={(e) => void handleSubmit(e)}>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.goalName")}
        <input aria-label={t("finance.goalName")} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.cardLimit")}
        <input aria-label={t("finance.cardLimit")} inputMode="decimal" placeholder={t("finance.amountPlaceholder")} className={inputClass} value={limit} onChange={(e) => setLimit(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.statementDay")}
        <input aria-label={t("finance.statementDay")} inputMode="numeric" className={inputClass} value={statementDay} onChange={(e) => setStatementDay(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.paymentDueDay")}
        <input aria-label={t("finance.paymentDueDay")} inputMode="numeric" className={inputClass} value={paymentDueDay} onChange={(e) => setPaymentDueDay(e.target.value)} />
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button type="submit" disabled={pending} className={btnClass}>{pending ? t("finance.saving") : t("finance.createCard")}</button>
        {error ? (<p role="alert" className="text-xs text-alert">{error}</p>) : null}
      </div>
    </form>
  );
}
