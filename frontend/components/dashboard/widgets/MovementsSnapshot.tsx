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
    return <div role="status">{t("common.loading")}</div>;
  }
  if (movements.error || accounts.error || categories.error) {
    return (
      <div role="alert">
        <p>{t("finance.movementsLoadFailed")}</p>
        <button
          type="button"
          onClick={() => {
            void mutate("finance/movements");
            void mutate("dashboard/accounts");
            void mutate("finance/categories");
          }}
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
      <div>
        <EmptyState
          title={t("dashboard.latestMovementsEmpty")}
          hint={t("finance.movementsEmptyHint")}
        />
        <Link
          href="/dashboard/finance/"
          className="mt-2 inline-block text-xs text-signal underline-offset-2 hover:underline"
        >
          {t("dashboard.viewInFinance")}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-hull px-3 py-2 text-sm"
          >
            <span className="min-w-0">
              <span className="block truncate">
                {row.direction === "expense"
                  ? t("finance.movementDirectionExpense")
                  : t("finance.movementDirectionIncome")}
                {row.description ? ` · ${row.description}` : ""}
              </span>
              <span className="mt-0.5 block truncate text-xs text-instrument/60">
                {row.displayDate}
                {row.categoryName ? ` · ${row.categoryName}` : ""} · {row.accountName}
              </span>
            </span>
            <span className="shrink-0 font-mono text-xs tabular-nums">
              {formatMoney(row.amount)}
            </span>
          </li>
        ))}
      </ul>
      <Link
        href="/dashboard/finance/"
        className="mt-2 inline-block text-xs text-signal underline-offset-2 hover:underline"
      >
        {t("dashboard.viewInFinance")}
      </Link>
    </div>
  );
}
