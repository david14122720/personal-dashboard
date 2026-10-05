"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { useAccounts } from "@/lib/api/dashboard";
import { useMovements } from "@/lib/api/finance";
import { toCategoryTrend, type NamedOption, type TrendPeriod } from "@/lib/finance/finance";
import CategoryTrendChart, {
  type TrendRow,
  type TrendSeries,
} from "@/components/finance/CategoryTrendChart";
import TrendPeriodSelector from "@/components/finance/TrendPeriodSelector";
import { SectionShell } from "@/components/finance/FinanceSections";
import EmptyState from "@/components/ui/EmptyState";

// Canonical field string from the UI-polish contract (`design.md`).
const selectClass =
  "min-h-11 w-full rounded-md border border-hull bg-deck px-3 text-sm text-instrument transition-colors placeholder:text-slate-500 focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/30";

/**
 * Per-category gasto/ingreso trend sourced from `GET /movements` (same
 * `finance/movements` SWR key as the history list, no new endpoint).
 * `toCategoryTrend` splits the category into a fixed number of consecutive
 * time buckets (14 days / 8 weeks / 12 months / 5 years) ordered oldest to
 * newest, keeps empty buckets at zero and never nets the two directions.
 * Aggregates are single-currency: only movements whose account matches the
 * user currency participate. The compare view lives on its own sub-route and
 * is reached only through the button below — never the nav.
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
  const [period, setPeriod] = useState<TrendPeriod>("month");
  const movements = useMovements();
  const accounts = useAccounts();
  const currencyByAccountId = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a.currency])),
    [accounts.data],
  );
  const buckets = useMemo(
    () =>
      selected
        ? toCategoryTrend(movements.data, {
            categoryId: selected,
            period,
            currencyByAccountId,
            userCurrency: currency,
          })
        : null,
    [movements.data, currencyByAccountId, currency, selected, period],
  );
  const rows: TrendRow[] = useMemo(
    () =>
      (buckets ?? []).map((bucket) => ({
        bucket: bucket.bucket,
        label: bucket.label,
        expense: bucket.expense,
        income: bucket.income,
      })),
    [buckets],
  );
  const series: TrendSeries[] = [
    { key: "expense", label: t("finance.chartExpenses"), token: "--color-signal" },
    { key: "income", label: t("finance.chartIncome"), token: "--color-flow" },
  ];
  const noDataInRange =
    buckets !== null && buckets.every((bucket) => bucket.expense === 0 && bucket.income === 0);
  return (
    <SectionShell
      title={t("finance.categoryChartTitle")}
      hint={t("finance.categoryChartHint")}
      span="col-span-12"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <label className="flex w-full max-w-md flex-col gap-1 text-xs text-instrument/60">
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
          <TrendPeriodSelector value={period} onChange={setPeriod} />
        </div>
        {buckets === null ? (
          <EmptyState title={t("finance.chartEmpty")} hint={t("finance.chartEmptyHint")} />
        ) : (
          <div className="flex flex-col gap-2">
            <CategoryTrendChart data={rows} series={series} locale={locale} currency={currency} />
            {noDataInRange ? (
              <p className="text-xs text-instrument/60">{t("finance.trendNoDataInRange")}</p>
            ) : null}
          </div>
        )}
        <div>
          <Link
            href="/dashboard/finance/compare/"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-hull px-3 font-display text-sm text-instrument-dim transition-colors hover:border-signal hover:text-signal"
          >
            {t("finance.compareButton")}
          </Link>
        </div>
      </div>
    </SectionShell>
  );
}
