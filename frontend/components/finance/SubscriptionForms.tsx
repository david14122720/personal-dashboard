"use client";

import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { t } from "@/lib/i18n";
import { ApiError } from "@/lib/api/client";
import { useAccounts } from "@/lib/api/dashboard";
import {
  deleteSubscription,
  patchSubscription,
  paySubscription,
  type SubscriptionWire,
} from "@/lib/api/finance";
import {
  isPaidThisCycle,
  toAccountOptions,
  todayInBogota,
} from "@/lib/finance/finance";
import { formatMoney, toNumber } from "@/lib/api/money";

const inputClass =
  "w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument placeholder:text-instrument/40 focus:border-signal focus:outline-none";
const btnClass =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:opacity-50";

/**
 * Finance subscription row: price + due + paid state, cancel/reactivate via
 * the widened `PATCH`, delete with explicit confirmation (movements survive
 * as audit via `ON DELETE SET NULL` — the row just disappears), and the Pay
 * action behind an account-pick modal. Paid state is derived during render
 * (`isPaidThisCycle`) — no effects, no timers. Pay is hidden for free
 * (`price = 0.00`) rows. The create/edit form lives in Settings
 * (`components/settings/SubscriptionsSection.tsx`), not here.
 */
export function SubscriptionRow({ sub }: { sub: SubscriptionWire }) {
  const { mutate } = useSWRConfig();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const payButtonRef = useRef<HTMLButtonElement>(null);

  // Render-derived paid state: stamped `last_paid_on` + `next_billing_on`
  // still in the future means this cycle is covered.
  const paid = isPaidThisCycle(
    { last_paid_on: sub.last_paid_on ?? null, next_billing_on: sub.next_billing_on },
    todayInBogota(),
  );
  const priceNumber = toNumber(sub.price);
  const payable = sub.is_active && !paid && priceNumber > 0;
  const isFree = priceNumber === 0;

  async function revalidate(): Promise<void> {
    await mutate("finance/subscriptions");
    await mutate("dashboard/subscriptions");
    await mutate("dashboard/accounts");
    await mutate("finance/movements");
  }

  async function toggle(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await patchSubscription(sub.id, { is_active: !sub.is_active });
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
    setError(null);
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
    <div className="flex flex-col gap-1 rounded-lg border border-hull px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{sub.name}</p>
          <p className="font-mono text-sm tabular-nums">
            {formatMoney(sub.price, { currency: sub.currency ?? "COP" })}
            {sub.next_billing_on ? ` · ${sub.next_billing_on}` : null}
          </p>
          {paid ? (
            <p className="mt-0.5 text-xs text-signal">{t("finance.paidThisCycle")}</p>
          ) : isFree ? (
            <p className="mt-0.5 text-xs text-instrument/60">{t("finance.subscriptionFreeNoPay")}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {payable ? (
            <button
              ref={payButtonRef}
              type="button"
              disabled={pending}
              onClick={() => setPayOpen(true)}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-signal px-4 py-2 font-display text-sm font-bold text-deck transition-colors hover:bg-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:opacity-50"
            >
              {t("finance.subscriptionPay")}
            </button>
          ) : null}
          <button type="button" disabled={pending} onClick={() => void toggle()} className={btnClass}>{sub.is_active ? t("finance.cancelSub") : t("finance.reactivateSub")}</button>
          <button type="button" disabled={pending} onClick={() => void remove()} className={btnClass}>{t("productivity.delete")}</button>
        </div>
      </div>
      {error ? (<p role="alert" className="text-xs text-alert">{error}</p>) : null}
      {payOpen ? (
        <PaySubscriptionModal
          sub={sub}
          openerRef={payButtonRef}
          onClose={() => setPayOpen(false)}
          onPaid={() => {
            setPayOpen(false);
            void revalidate();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Account-pick modal for the pay action. Sends only `{account_id}` to
 * `POST /subscriptions/{id}/pay`, then closes at once: the parent
 * revalidates the subscription row, the account card and the movements
 * history, and the row's "Pagado este ciclo" badge is the CSS-only
 * confirmation (no toast library). A 409 (already paid this cycle) keeps
 * the modal open with the Spanish `subscriptionPaidThisCycle` message.
 */
export function PaySubscriptionModal({
  sub,
  openerRef,
  onClose,
  onPaid,
}: {
  sub: SubscriptionWire;
  openerRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onPaid: () => void;
}) {
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const closedRef = useRef(false);

  const options = toAccountOptions(
    (accounts.data ?? []).map((row) => ({ id: row.id, name: row.name })),
  );

  function close(): void {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose();
    openerRef?.current?.focus();
  }

  // Focus the account picker on open; Esc closes without sending a request.
  useEffect(() => {
    selectRef.current?.focus();
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

  async function confirm(): Promise<void> {
    if (!accountId) {
      setError(t("finance.requiredFieldError"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await paySubscription(sub.id, accountId);
      // Close first: the parent revalidates every affected key and the
      // row badge confirms. Awaiting the revalidations here would leave
      // the success state lingering for seconds.
      onPaid();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(t("finance.subscriptionPaidThisCycle"));
      } else {
        setError(t("finance.saveFailed"));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t("finance.subscriptionPayTitle")} className="mt-2 rounded-lg border border-hull bg-deck p-3">
      <h3 className="font-display text-sm font-semibold">{t("finance.subscriptionPayTitle")}</h3>
      <p className="mt-1 font-mono text-sm tabular-nums">
        {sub.name} · {formatMoney(sub.price, { currency: sub.currency ?? "COP" })}
      </p>
      {error ? (<p role="alert" className="mt-2 text-xs text-alert">{error}</p>) : null}
      <label className="mt-3 flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.selectAccount")}
        <select
          ref={selectRef}
          aria-label={t("finance.selectAccount")}
          className={inputClass}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">{t("finance.selectAccount")}</option>
          {options.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
        </select>
      </label>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => void confirm()}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-signal px-4 py-2 font-display text-sm font-bold text-deck transition-colors hover:bg-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:opacity-50"
        >
          {pending ? t("finance.saving") : t("finance.subscriptionPayConfirm")}
        </button>
        <button type="button" onClick={close} className={btnClass}>{t("finance.cancel")}</button>
      </div>
    </div>
  );
}
