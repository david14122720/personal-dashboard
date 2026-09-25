"use client";

import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { t } from "@/lib/i18n";
import {
  createMovement,
  deleteMovement,
  patchMovement,
  type MovementWire,
} from "@/lib/api/finance";
import {
  normalizeManualAmount,
  todayInBogota,
  type NamedOption,
} from "@/lib/finance/finance";

/**
 * Add/edit modal for the movements ledger (`/dashboard/finance`).
 *
 * Amounts travel as decimal strings; client validation blocks the request
 * with Spanish messages. Success shows a CSS-only confirmation (no toast
 * library) and revalidates `finance/movements` plus `dashboard/accounts`
 * (the movement transaction rewrites the stored balance). Esc/cancel close
 * without sending a request and return focus to the opener.
 */

export type MovementModalMode =
  | { kind: "create"; direction: "expense" | "income" }
  | { kind: "edit"; movement: MovementWire };

export function MovementModal({
  mode,
  accounts,
  categories,
  openerRef,
  onClose,
}: {
  mode: MovementModalMode;
  accounts: NamedOption[];
  categories: NamedOption[];
  openerRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const { mutate } = useSWRConfig();
  const initial = mode.kind === "edit" ? mode.movement : null;

  const [direction, setDirection] = useState<"expense" | "income">(
    initial?.direction ?? (mode.kind === "create" ? mode.direction : "expense"),
  );
  const [amount, setAmount] = useState(
    initial ? String(initial.amount) : "",
  );
  const [accountId, setAccountId] = useState(initial?.account_id ?? "");
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? "");
  const [occurredOn, setOccurredOn] = useState(
    initial?.occurred_on ?? todayInBogota(),
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<"created" | "updated" | "deleted" | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const amountRef = useRef<HTMLInputElement>(null);
  const closedRef = useRef(false);

  function close(): void {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose();
    openerRef?.current?.focus();
  }

  // Focus the amount field on open; Esc closes without sending a request.
  useEffect(() => {
    amountRef.current?.focus();
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function revalidate(): Promise<void> {
    await mutate("finance/movements");
    await mutate("dashboard/accounts");
  }

  function validate(): string | null {
    const wire = normalizeManualAmount(amount);
    if (wire === null) return t("finance.amountPositiveError");
    if (!accountId || !categoryId || !occurredOn.trim()) {
      return t("finance.requiredFieldError");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn.trim())) {
      return t("finance.requiredFieldError");
    }
    return null;
  }

  async function save(): Promise<void> {
    const failure = validate();
    if (failure) {
      setError(failure);
      return;
    }
    const wire = normalizeManualAmount(amount) as string;
    setSaving(true);
    setError(null);
    try {
      const body = {
        direction,
        amount: wire,
        account_id: accountId,
        category_id: categoryId,
        occurred_on: occurredOn.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      };
      if (initial) {
        await patchMovement(initial.id, body);
        setSaved("updated");
      } else {
        await createMovement(body);
        setSaved("created");
      }
      await revalidate();
    } catch {
      setError(t("finance.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(): Promise<void> {
    if (!initial) return;
    setSaving(true);
    setError(null);
    try {
      await deleteMovement(initial.id);
      setConfirmingDelete(false);
      setSaved("deleted");
      await revalidate();
    } catch {
      setError(t("finance.deleteFailed"));
    } finally {
      setSaving(false);
    }
  }

  const title =
    mode.kind === "edit"
      ? t("finance.movementModalEditTitle")
      : direction === "expense"
        ? t("finance.movementModalExpenseTitle")
        : t("finance.movementModalIncomeTitle");

  const fieldClass =
    "mt-1 min-h-[44px] w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal";
  const labelClass = "block text-xs text-instrument/60";
  const primaryBtn =
    "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-signal px-4 py-2 text-sm font-bold text-deck transition-colors hover:bg-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:opacity-50";
  const ghostBtn =
    "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-hull px-4 py-2 text-sm transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:opacity-50";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      data-testid="movement-modal-overlay"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="movement-modal-title"
        className="w-full max-w-md rounded-xl border border-hull bg-deck p-5"
      >
        <h2 id="movement-modal-title" className="font-display text-lg font-semibold">
          {title}
        </h2>
        {saved ? (
          <div role="status" className="mt-4 rounded-lg border border-signal/40 bg-signal/10 p-4">
            <p className="text-sm font-medium text-signal">
              {saved === "deleted" ? t("finance.movementDeleted") : t("finance.movementSaved")}
            </p>
            <button type="button" onClick={close} className={`mt-3 ${ghostBtn}`}>
              {t("finance.close")}
            </button>
          </div>
        ) : (
          <form
            className="mt-4 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className={labelClass}>
              {t("finance.movementPaymentLabel")}
              <select
                aria-label={t("finance.movementPaymentLabel")}
                value={direction}
                onChange={(e) => setDirection(e.target.value as "expense" | "income")}
                className={fieldClass}
              >
                <option value="expense">{t("finance.movementDirectionExpense")}</option>
                <option value="income">{t("finance.movementDirectionIncome")}</option>
              </select>
            </label>
            <label className={labelClass}>
              {t("finance.amountCop")}
              <input
                ref={amountRef}
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={t("finance.amountPlaceholder")}
                aria-label={t("finance.amountCop")}
                aria-invalid={error ? true : undefined}
                className={`${fieldClass} font-mono tabular-nums`}
              />
            </label>
            <label className={labelClass}>
              {t("finance.account")}
              <select
                aria-label={t("finance.account")}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className={fieldClass}
              >
                <option value="">{t("finance.selectAccount")}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              {t("finance.category")}
              <select
                aria-label={t("finance.category")}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className={fieldClass}
              >
                <option value="">{t("finance.selectCategory")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              {t("finance.dateLabel")}
              <input
                type="date"
                value={occurredOn}
                onChange={(e) => setOccurredOn(e.target.value)}
                aria-label={t("finance.dateLabel")}
                className={fieldClass}
              />
            </label>
            <label className={labelClass}>
              {t("finance.movementDescriptionLabel")}
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("finance.movementDescriptionPlaceholder")}
                aria-label={t("finance.movementDescriptionLabel")}
                className={fieldClass}
              />
            </label>
            {error ? (
              <p role="alert" className="text-xs text-alert">
                {error}
              </p>
            ) : null}
            <div className="mt-1 flex flex-wrap gap-2">
              <button type="submit" disabled={saving} className={primaryBtn}>
                {saving ? t("finance.saving") : t("finance.save")}
              </button>
              <button type="button" onClick={close} className={ghostBtn}>
                {t("finance.cancel")}
              </button>
              {initial && !confirmingDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-alert/50 px-4 py-2 text-sm text-alert transition-colors hover:border-alert focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alert"
                >
                  {t("finance.movementDelete")}
                </button>
              ) : null}
            </div>
            {confirmingDelete && initial ? (
              <div className="rounded-lg border border-alert/50 bg-alert/10 p-3">
                <p className="text-xs text-instrument/80">{t("finance.movementDeleteConfirm")}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void remove()}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-alert px-4 py-2 text-sm font-bold text-deck transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alert disabled:opacity-50"
                  >
                    {t("finance.movementDelete")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className={ghostBtn}
                  >
                    {t("finance.cancel")}
                  </button>
                </div>
              </div>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}
