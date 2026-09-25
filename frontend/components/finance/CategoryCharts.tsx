"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/api/money";
import { useAccounts } from "@/lib/api/dashboard";
import { useMovements } from "@/lib/api/finance";
import { toCategoryMovementTotals, type NamedOption } from "@/lib/finance/finance";
import { SectionShell } from "@/components/finance/FinanceSections";
import EmptyState from "@/components/ui/EmptyState";

const selectClass =
  "w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument focus:border-signal focus:outline-none";

/** Two labeled div-bars (gasto/ingreso) with COP amounts, no chart dependency.
 * A series mounts only when its aggregated value is greater than zero, so an
 * expense-only category renders a single bar and the two directions are never
 * netted. Widths are static (no animated properties), so there is nothing to
 * suppress under `prefers-reduced-motion`. */
export function CategoryBars({
  expense,
  income,
  locale,
  currency,
}: {
  expense: number;
  income: number;
  locale: string;
  currency: string;
}) {
  const max = Math.max(expense, income, 1);
  const rows = [
    ...(expense > 0
      ? [{ key: "expense", label: t("finance.chartExpenses"), value: expense, className: "bg-signal" }]
      : []),
    ...(income > 0
      ? [{ key: "income", label: t("finance.chartIncome"), value: income, className: "bg-flow" }]
      : []),
  ];
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.key}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs text-instrument/60">{row.label}</p>
            <p className="font-mono text-sm tabular-nums">
              {formatMoney(row.value, { locale, currency })}
            </p>
          </div>
          <div
            role="progressbar"
            aria-label={row.label}
            aria-valuenow={Math.round(row.value)}
            aria-valuemin={0}
            aria-valuemax={Math.round(max)}
            className="mt-1 h-2.5 overflow-hidden rounded-full bg-deck"
          >
            <div
              className={`h-full rounded-full ${row.className}`}
              style={{ width: `${max > 0 ? (row.value / max) * 100 : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Per-category gasto/ingreso chart sourced from `GET /movements` (same
 * `finance/movements` SWR key as the history list, no new endpoint).
 * Aggregates are single-currency and never netted (see
 * `toCategoryMovementTotals`). The compare view lives on its own
 * sub-route and is reached only through the button below — never the nav.
 */
export function CategoryChartSection({
  categories,
  locale,
  currency,
}: {
  categories: NamedOption[];
  locale: string;
  currency: string;
}) {
  const [selected, setSelected] = useState("");
  const movements = useMovements();
  const accounts = useAccounts();
  const currencyByAccountId = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a.currency])),
    [accounts.data],
  );
  const totals = useMemo(
    () =>
      selected
        ? toCategoryMovementTotals(movements.data, currencyByAccountId, currency, selected)
        : null,
    [movements.data, currencyByAccountId, currency, selected],
  );
  return (
    <SectionShell
      title={t("finance.categoryChartTitle")}
      hint={t("finance.categoryChartHint")}
      span="col-span-12"
    >
      <div className="flex flex-col gap-4">
        <label className="flex max-w-md flex-col gap-1 text-xs text-instrument/60">
          {t("finance.categorySelectLabel")}
          <select
            aria-label={t("finance.categorySelectLabel")}
            className={selectClass}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">{t("finance.selectCategory")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {!totals ? (
          <EmptyState title={t("finance.chartEmpty")} hint={t("finance.chartEmptyHint")} />
        ) : totals.expense === 0 && totals.income === 0 ? (
          <EmptyState title={t("finance.chartEmpty")} hint={t("finance.chartEmptyHint")} />
        ) : (
          <CategoryBars expense={totals.expense} income={totals.income} locale={locale} currency={currency} />
        )}
        <div>
          <Link
            href="/dashboard/finance/compare/"
            className="inline-flex items-center rounded-lg border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
          >
            {t("finance.compareButton")}
          </Link>
        </div>
      </div>
    </SectionShell>
  );
}
