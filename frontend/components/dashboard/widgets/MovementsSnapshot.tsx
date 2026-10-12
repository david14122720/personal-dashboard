"use client";
import Link from "next/link";
import { useSWRConfig } from "swr";
import DeckCard, { DeckEmptyState } from "@/components/dashboard/DeckCard";
import { SectionError, SectionSkeleton } from "@/components/dashboard/SectionStates";
import {
  ExpenseRowIcon,
  IncomeRowIcon,
  TransferRowIcon,
} from "@/components/dashboard/icons";
import { deck } from "@/components/ui/deckStyles";
import { useAccounts } from "@/lib/api/dashboard";
import { useCategories, useMovements } from "@/lib/api/finance";
import { formatMoney } from "@/lib/api/money";
import {
  toAccountOptions,
  toCategoryOptions,
  toMovementRows,
} from "@/lib/finance/finance";
import { t } from "@/lib/i18n";

/** Direction color of a movement row: the tile tracks the amount color. */
const TILE_CLASS: Record<string, string> = {
  expense: "border-rose-500/20 bg-rose-500/10 text-rose-400",
  income: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  transfer: "border-sky-500/20 bg-sky-500/10 text-sky-400",
};

const AMOUNT_CLASS: Record<string, string> = {
  expense: "text-rose-400",
  income: "text-emerald-400",
  transfer: "text-sky-400",
};

/**
 * «Últimos movimientos»: latest 5 from `GET /movements` (same
 * `finance/movements` SWR key, API order kept, never re-sorted) in the
 * prototype row recipe — direction tiles, category chip, real date/account meta
 * — plus a link to Finance. The counter states the real record count and marks
 * the rows the 5-row slice hides (JD item 3), so the slice length is never
 * reported as the ledger size. Independent Spanish loading/error/empty; retry
 * revalidates only this section's own SWR keys.
 */
export default function MovementsSnapshot({ className }: { className?: string } = {}) {
  const movements = useMovements();
  const accounts = useAccounts();
  const categories = useCategories();
  const { mutate } = useSWRConfig();

  const allRows = toMovementRows(
    movements.data,
    toAccountOptions(accounts.data),
    toCategoryOptions(categories.data),
  );
  const rows = allRows.slice(0, 5);
  const hiddenRows = allRows.length - rows.length;

  return (
    <DeckCard
      title={t("dashboard.latestMovementsTitle")}
      hint={t("dashboard.latestMovementsHint")}
      className={className}
      meta={
        rows.length > 0 ? (
          <span className={deck.countPill}>
            {t("dashboard.recordsMeta", { n: allRows.length })}
            {hiddenRows > 0 ? ` · ${t("dashboard.recordsMore", { n: hiddenRows })}` : ""}
          </span>
        ) : null
      }
    >
      {movements.isLoading || accounts.isLoading || categories.isLoading ? (
        <SectionSkeleton label={t("common.loading")} />
      ) : movements.error || accounts.error || categories.error ? (
        <SectionError
          message={t("finance.movementsLoadFailed")}
          onRetry={() => {
            void mutate("finance/movements");
            void mutate("dashboard/accounts");
            void mutate("finance/categories");
          }}
        />
      ) : (
        <div className="animate-fade-in motion-reduce:animate-none">
          {rows.length === 0 ? (
            <DeckEmptyState
              icon={<ExpenseRowIcon className="h-5 w-5" />}
              title={t("dashboard.latestMovementsEmpty")}
              hint={t("finance.movementsEmptyHint")}
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {rows.map((row) => {
                const directionLabel =
                  row.direction === "expense"
                    ? t("finance.movementDirectionExpense")
                    : row.direction === "income"
                      ? t("finance.movementDirectionIncome")
                      : t("finance.movementDirectionTransfer");
                const amountSign =
                  row.direction === "expense" ? "-" : row.direction === "income" ? "+" : "";
                return (
                  <li key={row.id} className={deck.listRow}>
                    <div className="flex items-start gap-3 sm:items-center">
                      <span className={`${deck.rowIconTile} ${TILE_CLASS[row.direction] ?? TILE_CLASS.transfer}`}>
                        {row.direction === "expense" ? (
                          <ExpenseRowIcon className="h-4 w-4" />
                        ) : row.direction === "income" ? (
                          <IncomeRowIcon className="h-4 w-4" />
                        ) : (
                          <TransferRowIcon className="h-4 w-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-slate-200">
                            {directionLabel}
                            {row.description ? ` · ${row.description}` : ""}
                          </h3>
                          {row.categoryName ? (
                            <span className={deck.rowChip}>{row.categoryName}</span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-xs text-muted">
                          {row.displayDate}
                          {row.direction === "transfer"
                            ? ` · ${t("finance.movementTransferRoute", {
                                from: row.accountName,
                                to: row.transferAccountName ?? "—",
                              })}`
                            : ` · ${
                                row.direction === "income"
                                  ? t("finance.movementAccountLabel")
                                  : t("finance.paymentMethod")
                              }: ${row.accountName}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-left sm:flex-col sm:items-end sm:justify-center sm:text-right">
                      <span
                        className={`font-mono text-sm font-bold ${
                          AMOUNT_CLASS[row.direction] ?? AMOUNT_CLASS.transfer
                        }`}
                      >
                        {amountSign}
                        {formatMoney(row.amount)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className={deck.cardFooterRow}>
            <Link href="/dashboard/finance/" className={deck.cardFooterLink}>
              <span>{t("dashboard.viewInFinance")}</span>
              <span
                aria-hidden="true"
                className="transition-transform group-hover:translate-x-0.5"
              >
                →
              </span>
            </Link>
          </div>
        </div>
      )}
    </DeckCard>
  );
}
