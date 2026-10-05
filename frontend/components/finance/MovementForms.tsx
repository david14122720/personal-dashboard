"use client";

import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { t } from "@/lib/i18n";
import {
  createMovement,
  createTransfer,
  deleteMovement,
  patchMovement,
  type MovementWire,
} from "@/lib/api/finance";
import { serverMessage } from "@/lib/api/client";
import {
  normalizeManualAmount,
  todayInBogota,
  type NamedOption,
} from "@/lib/finance/finance";
import { useBodyScrollLock } from "@/components/ui/useBodyScrollLock";

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

/** Keyboard-focusable elements inside an open dialog, in DOM order. */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Keep Tab/Shift+Tab cycling inside `container` so the dialogs' explicit
 * `aria-modal="true"` claim matches behavior. Wraps from the last focusable
 * node to the first (and back); a no-op when the container has none.
 */
function trapTabKey(event: KeyboardEvent, container: HTMLElement | null): void {
  if (!container) return;
  const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const inside = active !== null && container.contains(active);
  if (event.shiftKey) {
    if (!inside || active === first) {
      event.preventDefault();
      last.focus();
    }
    return;
  }
  if (!inside || active === last) {
    event.preventDefault();
    first.focus();
  }
}

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

  // Transfers are create/delete only (D2.4), so the edit modal never receives
  // one; the third direction is narrowed explicitly instead of leaking into
  // the two-direction form (the type gate requires it).
  const [direction, setDirection] = useState<"expense" | "income">(() => {
    if (mode.kind === "create") return mode.direction;
    return mode.movement.direction === "income" ? "income" : "expense";
  });
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const closedRef = useRef(false);

  // The ledger behind the modal must not scroll while the modal is open.
  useBodyScrollLock(true);

  function close(): void {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose();
    openerRef?.current?.focus();
  }

  // Focus the amount field on open; Esc closes without sending a request and
  // Tab/Shift+Tab stay inside the dialog.
  useEffect(() => {
    amountRef.current?.focus();
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "Tab") {
        trapTabKey(event, dialogRef.current);
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
    } catch (err) {
      setError(serverMessage(err, t("finance.saveFailed")));
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
    } catch (err) {
      setError(serverMessage(err, t("finance.deleteFailed")));
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
    "mt-1 min-h-11 w-full rounded-md border border-hull bg-deck px-3 text-sm text-instrument transition-colors placeholder:text-slate-500 focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/30";
  const labelClass = "block text-xs text-instrument/60";
  const primaryBtn =
    "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-signal px-4 font-display text-sm font-semibold text-deck transition-colors hover:bg-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:cursor-not-allowed disabled:opacity-50";
  const ghostBtn =
    "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-hull px-4 font-display text-sm text-instrument-dim transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4"
      data-testid="movement-modal-overlay"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="movement-modal-title"
        className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-xl border border-hull bg-panel p-4 sm:p-5"
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
            <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:justify-end">
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
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
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

/** Owned account as a transfer selector option: name for display, currency
 * for the client-side same-currency check (the backend still re-validates). */
export interface TransferAccountOption {
  id: string;
  name: string;
  currency: string;
}

/**
 * «Mover dinero» modal: one transfer between two own accounts. The origin is
 * preselected by the account row that opens it and the destination selector
 * never offers the chosen origin. Changing the origin to the account already
 * chosen as destination clears that now-invalid selection live (the
 * same-account save check stays as the backstop). The same-account and
 * cross-currency checks block the request in Spanish before it is sent;
 * success shows the CSS-only confirmation and revalidates
 * `finance/movements` (the new row) plus `dashboard/accounts` (both balances
 * were rewritten).
 */
export function TransferModal({
  accounts,
  initialFromAccountId = "",
  openerRef,
  onClose,
}: {
  accounts: TransferAccountOption[];
  initialFromAccountId?: string;
  openerRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const { mutate } = useSWRConfig();
  const [fromAccountId, setFromAccountId] = useState(initialFromAccountId);
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayInBogota());
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const amountRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closedRef = useRef(false);

  // The ledger behind the modal must not scroll while the modal is open.
  useBodyScrollLock(true);

  function close(): void {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose();
    openerRef?.current?.focus();
  }

  // Focus the amount field on open; Esc closes without sending a request and
  // Tab/Shift+Tab stay inside the dialog.
  useEffect(() => {
    amountRef.current?.focus();
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "Tab") {
        trapTabKey(event, dialogRef.current);
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
    if (!fromAccountId || !toAccountId || !occurredOn.trim()) {
      return t("finance.requiredFieldError");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn.trim())) {
      return t("finance.requiredFieldError");
    }
    if (fromAccountId === toAccountId) return t("finance.transferSameAccountError");
    const from = accounts.find((a) => a.id === fromAccountId);
    const to = accounts.find((a) => a.id === toAccountId);
    if (from && to && from.currency !== to.currency) {
      return t("finance.transferCurrencyError");
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
      await createTransfer({
        from_account_id: fromAccountId,
        to_account_id: toAccountId,
        amount: wire,
        occurred_on: occurredOn.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setSaved(true);
      await revalidate();
    } catch (err) {
      setError(serverMessage(err, t("finance.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  const fieldClass =
    "mt-1 min-h-11 w-full rounded-md border border-hull bg-deck px-3 text-sm text-instrument transition-colors placeholder:text-slate-500 focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/30";
  const labelClass = "block text-xs text-instrument/60";
  const primaryBtn =
    "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-signal px-4 font-display text-sm font-semibold text-deck transition-colors hover:bg-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:cursor-not-allowed disabled:opacity-50";
  const ghostBtn =
    "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-hull px-4 font-display text-sm text-instrument-dim transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4"
      data-testid="transfer-modal-overlay"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-modal-title"
        className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-xl border border-hull bg-panel p-4 sm:p-5"
      >
        <h2 id="transfer-modal-title" className="font-display text-lg font-semibold">
          {t("finance.transferModalTitle")}
        </h2>
        {saved ? (
          <div role="status" className="mt-4 rounded-lg border border-signal/40 bg-signal/10 p-4">
            <p className="text-sm font-medium text-signal">{t("finance.transferSaved")}</p>
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
              {t("finance.transferFrom")}
              <select
                aria-label={t("finance.transferFrom")}
                value={fromAccountId}
                onChange={(e) => {
                  const nextFrom = e.target.value;
                  setFromAccountId(nextFrom);
                  // The destination must react live: a selection that equals the
                  // new origin is invalid and would otherwise survive in state.
                  if (toAccountId === nextFrom) setToAccountId("");
                }}
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
              {t("finance.transferTo")}
              <select
                aria-label={t("finance.transferTo")}
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
                className={fieldClass}
              >
                <option value="">{t("finance.selectAccount")}</option>
                {accounts
                  .filter((a) => a.id !== fromAccountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
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
            <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="submit" disabled={saving} className={primaryBtn}>
                {saving ? t("finance.saving") : t("finance.save")}
              </button>
              <button type="button" onClick={close} className={ghostBtn}>
                {t("finance.cancel")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
