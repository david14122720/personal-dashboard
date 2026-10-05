"use client";
import Link from "next/link";
import { useSWRConfig } from "swr";
import EmptyState from "@/components/ui/EmptyState";
import { useAccounts } from "@/lib/api/dashboard";
import { useCategories, useMovements } from "@/lib/api/finance";
import { formatMoney } from "@/lib/api/money";
import {
  toAccountOptions,
  toCategoryOptions,
  toMovementRows,
} from "@/lib/finance/finance";
import { t } from "@/lib/i18n";

/**
 * «Últimos movimientos»: latest 5 from `GET /movements` (same
 * `finance/movements` SWR key, API order kept, never re-sorted) with
 * direction, COP amount, Spanish date, category and account, plus a link
 * to Finance. Independent Spanish loading/error/empty; retry revalidates
 * only this section's own SWR keys.
 */
export default function MovementsSnapshot() {
  const movements = useMovements();
  const accounts = useAccounts();
  const categories = useCategories();
  const { mutate } = useSWRConfig();

  if (movements.isLoading || accounts.isLoading || categories.isLoading) {
    return (
      <div
        role="status"
        aria-label={t("common.loading")}
        className="animate-pulse rounded-xl border border-hull bg-hull/40 p-5"
      >
        <div className="h-4 w-24 rounded bg-hull" />
      </div>
    );
  }
  if (movements.error || accounts.error || categories.error) {
    return (
      <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-4 sm:p-5">
        <p className="text-sm text-instrument/70">{t("finance.movementsLoadFailed")}</p>
        <button
          type="button"
          onClick={() => {
            void mutate("finance/movements");
            void mutate("dashboard/accounts");
            void mutate("finance/categories");
          }}
          className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-hull px-3 font-display text-sm text-instrument-dim transition-colors hover:border-signal hover:text-signal"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  const rows = toMovementRows(
    movements.data,
    toAccountOptions(accounts.data),
    toCategoryOptions(categories.data),
  ).slice(0, 5);

  if (rows.length === 0) {
    return (
      <div className="animate-fade-in motion-reduce:animate-none">
        <EmptyState
          title={t("dashboard.latestMovementsEmpty")}
          hint={t("finance.movementsEmptyHint")}
        />
        <Link
          href="/dashboard/finance/"
          className="mt-2 inline-flex min-h-11 items-center text-xs text-signal underline-offset-2 hover:underline"
        >
          {t("dashboard.viewInFinance")}
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-fade-in motion-reduce:animate-none">
      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const directionLabel =
            row.direction === "expense"
              ? t("finance.movementDirectionExpense")
              : row.direction === "income"
                ? t("finance.movementDirectionIncome")
                : t("finance.movementDirectionTransfer");
          return (
            <li
              key={row.id}
              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
                row.direction === "transfer" ? "border-signal/50 bg-signal/5" : "border-hull"
              }`}
            >
              <span className="min-w-0">
                <span className="line-clamp-2 sm:block sm:truncate">
                  {directionLabel}
                  {row.description ? ` · ${row.description}` : ""}
                </span>
                <span className="mt-0.5 line-clamp-2 text-xs text-slate-400 sm:block sm:truncate">
                  {row.displayDate}
                  {row.direction === "transfer"
                    ? ` · ${t("finance.movementTransferRoute", {
                        from: row.accountName,
                        to: row.transferAccountName ?? "—",
                      })}`
                    : `${row.categoryName ? ` · ${row.categoryName}` : ""} · ${
                        row.direction === "income"
                          ? t("finance.movementAccountLabel")
                          : t("finance.paymentMethod")
                      }: ${row.accountName}`}
                </span>
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums">
                {formatMoney(row.amount)}
              </span>
            </li>
          );
        })}
      </ul>
      <Link
        href="/dashboard/finance/"
        className="mt-2 inline-flex min-h-11 items-center text-xs text-signal underline-offset-2 hover:underline"
      >
        {t("dashboard.viewInFinance")}
      </Link>
    </div>
  );
}
