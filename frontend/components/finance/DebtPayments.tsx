"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { t } from "@/lib/i18n";
import { createPayment, deletePayment, patchDebt, useDebtPayments, type DebtPaymentWire } from "@/lib/api/finance";
import { toNumber } from "@/lib/api/money";
import { normalizeManualAmount, toDebtProgress } from "@/lib/finance/finance";

const inputClass =
  "w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument placeholder:text-instrument/40 focus:border-signal focus:outline-none";
const btnClass =
  "rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal disabled:opacity-50";

/** Nuevo abono con guard cliente amount<=pending (el 422 BE manda). */
export function DebtPayForm({
  debtId, pending, currency, onDone,
}: { debtId: string; pending: number; currency: string; onDone: () => void }) {
  const { mutate } = useSWRConfig();
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingReq, setPendingReq] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const wire = normalizeManualAmount(amount);
    if (!wire || !paidOn) { setError(!wire ? t("finance.amountPositiveError") : t("finance.requiredFieldError")); return; }
    if (toNumber(wire) > pending) { setError(t("finance.overPayment")); return; }
    setPendingReq(true);
    try {
      await createPayment(debtId, { amount: wire, paid_on: paidOn, ...(method ? { payment_method: method } : {}) });
      setAmount("");
      await mutate(`finance/debt-payments/${debtId}`);
      await mutate("finance/debts");
      onDone();
    } catch {
      setError(t("finance.saveFailed"));
    } finally {
      setPendingReq(false);
    }
  }

  return (
    <form aria-label={t("finance.debts")} className="grid grid-cols-2 gap-3" onSubmit={(e) => void handleSubmit(e)}>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.amountCop")}
        <input aria-label={t("finance.amountCop")} inputMode="decimal" placeholder={t("finance.amountPlaceholder")} className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.dateLabel")}
        <input aria-label={t("finance.dateLabel")} type="date" className={inputClass} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      </label>
      <label className="col-span-2 flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.paymentMethod")}
        <select aria-label={t("finance.paymentMethod")} className={inputClass} value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">{t("finance.selectPaymentMethod")}</option>
          <option value="efectivo">{t("finance.paymentCash")}</option>
          <option value="débito">{t("finance.paymentDebit")}</option>
          <option value="transferencia">{t("finance.paymentTransfer")}</option>
          <option value="tarjeta">{t("finance.paymentCard")}</option>
          <option value="otro">{t("finance.paymentOther")}</option>
        </select>
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button type="submit" disabled={pendingReq} className={btnClass}>{pendingReq ? t("finance.saving") : t("finance.deposit")}</button>
        {error ? (<p role="alert" className="text-xs text-alert">{error}</p>) : null}
      </div>
    </form>
  );
}

/** Historial vía useDebtPayments; corregir = DELETE + prefill con confirmación. */
export function DebtPaymentHistory({
  debtId, onCorrect,
}: { debtId: string; onCorrect: (payment: DebtPaymentWire) => void }) {
  const { mutate } = useSWRConfig();
  const { data } = useDebtPayments(debtId);

  async function handleCorrect(payment: DebtPaymentWire): Promise<void> {
    if (!window.confirm(t("finance.confirmDeletePayment"))) return;
    await deletePayment(debtId, payment.id);
    await mutate(`finance/debt-payments/${debtId}`);
    await mutate("finance/debts");
    onCorrect(payment);
  }

  return (
    <div aria-label={t("finance.paymentHistory")}>
      <h3 className="font-display text-sm font-medium">{t("finance.paymentHistory")}</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {(data ?? []).map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-hull px-3 py-2">
            <p className="text-sm">{String(p.amount)} · {p.paid_on}</p>
            <button type="button" onClick={() => void handleCorrect(p)} className={btnClass}>{t("finance.correctPayment")}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Barra debo/aboné/falta con toDebtProgress puro. */
export function DebtProgressBar({ original, pendingAmount }: { original: number; pendingAmount: number }) {
  const progress = toDebtProgress({ original, pending: pendingAmount });
  return (
    <div role="progressbar" aria-label={t("finance.debts")} aria-valuenow={Math.round(progress.pct * 100)} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-deck">
      <div className="h-full rounded-full bg-signal" style={{ width: `${progress.pct * 100}%` }} />
    </div>
  );
}

/** Solo metadata (nombres reales creditor/installment/interest_rate, nunca montos). */
export function DebtEditForm({ debtId, onDone }: { debtId: string; onDone: () => void }) {
  const { mutate } = useSWRConfig();
  const [creditor, setCreditor] = useState("");
  const [installment, setInstallment] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingReq, setPendingReq] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!creditor.trim()) { setError(t("finance.requiredFieldError")); return; }
    setPendingReq(true);
    try {
      await patchDebt(debtId, { creditor: creditor.trim(), ...(installment.trim() ? { installment: installment.trim() } : {}), ...(interestRate.trim() ? { interest_rate: interestRate.trim() } : {}) });
      await mutate("finance/debts");
      onDone();
    } catch {
      setError(t("finance.saveFailed"));
    } finally {
      setPendingReq(false);
    }
  }

  return (
    <form aria-label={t("finance.debts")} className="grid grid-cols-2 gap-3" onSubmit={(e) => void handleSubmit(e)}>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.creditor")}
        <input aria-label={t("finance.creditor")} className={inputClass} value={creditor} onChange={(e) => setCreditor(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.installment")}
        <input aria-label={t("finance.installment")} inputMode="decimal" className={inputClass} value={installment} onChange={(e) => setInstallment(e.target.value)} />
      </label>
      <label className="col-span-2 flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.interestRate")}
        <input aria-label={t("finance.interestRate")} inputMode="decimal" className={inputClass} value={interestRate} onChange={(e) => setInterestRate(e.target.value)} />
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button type="submit" disabled={pendingReq} className={btnClass}>{pendingReq ? t("finance.saving") : t("productivity.save")}</button>
        {error ? (<p role="alert" className="text-xs text-alert">{error}</p>) : null}
      </div>
    </form>
  );
}
