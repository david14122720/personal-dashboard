"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import EmptyState from "@/components/ui/EmptyState";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/api/money";
import {
  deleteMovement,
  useMovements,
  type MovementWire,
} from "@/lib/api/finance";
import {
  toMovementRows,
  type NamedOption,
} from "@/lib/finance/finance";

/**
 * Movements history (`/dashboard/finance`): the latest 50 movements in API
 * order with composable account/category/direction filters. The account
 * filter is owned by `FinanceScreens` (account-card click sets it); category
 * and direction live here. Loading/error/empty render independently in
 * Spanish so the rest of Finance keeps rendering; retry revalidates only
 * `finance/movements`.
 */

const HISTORY_LIMIT = 50;

export function MovementHistory({
  accounts,
  categories,
  locale,
  currency,
  activeAccountId,
  onSelectAccount,
  onEdit,
}: {
  accounts: NamedOption[];
  categories: NamedOption[];
  locale: string;
  currency: string;
  activeAccountId: string | null;
  onSelectAccount: (id: string | null) => void;
  onEdit: (movement: MovementWire) => void;
}) {
  const { mutate } = useSWRConfig();
  const movements = useMovements();
  const [categoryId, setCategoryId] = useState("");
  const [direction, setDirection] = useState<"" | "expense" | "income">("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const wires = movements.data ?? [];
  const latest = wires.slice(0, HISTORY_LIMIT);
  const visible = latest.filter(
    (m) =>
      (!activeAccountId || m.account_id === activeAccountId) &&
      (!categoryId || (m.category_id ?? "") === categoryId) &&
      (!direction || m.direction === direction),
  );
  const rows = toMovementRows(visible, accounts, categories, locale);
  const hasFilters = activeAccountId !== null || categoryId !== "" || direction !== "";

  function clearFilters(): void {
    onSelectAccount(null);
    setCategoryId("");
    setDirection("");
  }

  async function retry(): Promise<void> {
    await mutate("finance/movements");
  }

  async function remove(id: string): Promise<void> {
    setDeleting(true);
    setActionError(null);
    try {
      await deleteMovement(id);
      setConfirmingDeleteId(null);
      await mutate("finance/movements");
      await mutate("dashboard/accounts");
    } catch {
      setActionError(t("finance.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  const selectClass =
    "mt-1 min-h-[44px] w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal";
  const labelClass = "block text-xs text-instrument/60";

  if (movements.isLoading && !movements.data) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-2">
        {[0, 1, 2].map((n) => (
          <div key={n} className="h-16 animate-pulse rounded-lg border border-hull bg-hull/40" />
        ))}
      </div>
    );
  }

  if (movements.error && !movements.data) {
    return (
      <div role="alert" className="rounded-lg border border-alert/50 bg-alert/10 p-4">
        <p className="text-sm font-medium">{t("finance.movementsLoadFailed")}</p>
        <button
          type="button"
          onClick={() => void retry()}
          className="mt-3 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-hull px-4 py-2 text-sm transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          {t("finance.movementFilterAccount")}
          <select
            aria-label={t("finance.movementFilterAccount")}
            value={activeAccountId ?? ""}
            onChange={(e) => onSelectAccount(e.target.value || null)}
            className={selectClass}
          >
            <option value="">{t("finance.movementFilterAll")}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          {t("finance.movementFilterCategory")}
          <select
            aria-label={t("finance.movementFilterCategory")}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={selectClass}
          >
            <option value="">{t("finance.movementFilterAll")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          {t("finance.movementFilterDirection")}
          <select
            aria-label={t("finance.movementFilterDirection")}
            value={direction}
            onChange={(e) => setDirection(e.target.value as "" | "expense" | "income")}
            className={selectClass}
          >
            <option value="">{t("finance.movementFilterAll")}</option>
            <option value="expense">{t("finance.movementDirectionExpense")}</option>
            <option value="income">{t("finance.movementDirectionIncome")}</option>
          </select>
        </label>
      </div>
      {activeAccountId ? (
        <p className="mt-2 text-xs text-instrument/70">
          {t("finance.movementActiveAccount", {
            name: accounts.find((a) => a.id === activeAccountId)?.name ?? activeAccountId,
          })}
        </p>
      ) : null}
      {hasFilters ? (
        <button
          type="button"
          onClick={clearFilters}
          className="mt-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-hull px-4 py-2 text-xs transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
        >
          {t("finance.movementFilterClear")}
        </button>
      ) : null}
      {actionError ? (
        <p role="alert" className="mt-2 text-xs text-alert">
          {actionError}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <div className="mt-3">
          <EmptyState title={t("finance.movementsEmpty")} hint={t("finance.movementsEmptyHint")} />
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((row) => {
            const wire = visible.find((w) => w.id === row.id) as MovementWire;
            const confirming = confirmingDeleteId === row.id;
            return (
              <li
                key={row.id}
                style={{ contentVisibility: "auto", containIntrinsicSize: "0 72px" }}
                className="rounded-lg border border-hull px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {row.direction === "expense"
                        ? t("finance.movementDirectionExpense")
                        : t("finance.movementDirectionIncome")}{" "}
                      · {row.categoryName ?? "—"}
                    </p>
                    <p className="truncate text-xs text-instrument/60">
                      {row.displayDate} · {row.accountName}
                      {row.description ? ` · ${row.description}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 font-mono text-sm tabular-nums">
                    {formatMoney(row.amount, { locale, currency })}
                  </p>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onEdit(wire)}
                    aria-label={`${t("finance.editMovement")}: ${row.displayDate}`}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-hull px-3 py-2 text-xs transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                  >
                    {t("finance.editMovement")}
                  </button>
                  {!confirming ? (
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(row.id)}
                      aria-label={`${t("finance.movementDelete")}: ${row.displayDate}`}
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-hull px-3 py-2 text-xs transition-colors hover:border-alert hover:text-alert focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alert"
                    >
                      {t("finance.movementDelete")}
                    </button>
                  ) : (
                    <>
                      <span className="inline-flex min-h-[44px] items-center text-xs text-instrument/70">
                        {t("finance.movementDeleteConfirm")}
                      </span>
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={() => void remove(row.id)}
                        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-alert px-3 py-2 text-xs font-bold text-deck transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alert disabled:opacity-50"
                      >
                        {t("finance.movementDelete")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDeleteId(null)}
                        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-hull px-3 py-2 text-xs transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                      >
                        {t("finance.cancel")}
                      </button>
                    </>
                  )}
                </div>
                {confirming && actionError ? (
                  <p role="alert" className="mt-1 text-xs text-alert">
                    {actionError}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
