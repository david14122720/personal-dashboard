"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { useAccounts } from "@/lib/api/dashboard";
import { useMovementsRange } from "@/lib/api/finance";
import {
  toCategoryTrend,
  trendBuckets,
  trendRange,
  type NamedOption,
  type TrendPeriod,
} from "@/lib/finance/finance";
import CategoryTrendChart, {
  type TrendRow,
  type TrendSeries,
} from "@/components/finance/CategoryTrendChart";
import TrendPeriodSelector from "@/components/finance/TrendPeriodSelector";
import DeckCard, { DeckEmptyState } from "@/components/dashboard/DeckCard";
import { CalendarActionIcon } from "@/components/dashboard/icons";
import { deck } from "@/components/ui/deckStyles";
import { chartDeckFrameClass } from "@/components/ui/chartTheme";
import { QueryStatsIcon } from "@/components/finance/FinanceIcons";
import { formatMoney } from "@/lib/api/money";

// Canonical field string from the UI-polish contract (`design.md`).
const selectClass =
  "min-h-11 w-full rounded-lg border border-hair bg-card px-3 text-xs text-instrument transition-colors focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/30";

/** Real period range of the current buckets (`YYYY-MM-DD` bounds, inclusive). */
function trendRangeLabel(
  period: TrendPeriod,
  locale: string,
  now?: Date,
): string | null {
  const windows = trendBuckets(period, now);
  const first = windows[0];
  const last = windows[windows.length - 1];
  if (!first || !last) return null;
  if (period === "year") return `${first.from.slice(0, 4)} – ${last.to.slice(0, 4)}`;
  // UTC anchors: the bounds are local `YYYY-MM-DD` strings and must not shift.
  // The month span crosses a year boundary, so it carries the 2-digit year.
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  };
  if (period === "month") options.year = "2-digit";
  const fmt = new Intl.DateTimeFormat(locale, options);
  return `${fmt.format(new Date(`${first.from}T00:00:00Z`))} – ${fmt.format(
    new Date(`${last.to}T00:00:00Z`),
  )}`;
}

/**
 * Per-category gasto/ingreso trend sourced from the ranged `GET /movements`
 * read (`useMovementsRange(trendRange(period))`: exactly the window the
 * buckets render, so the server already discards everything outside it) and
 * fetched only once a category is selected — without one there is no series,
 * so the panel never downloads the window just to render the empty state (S1).
 * `GET /movements/summary` cannot serve this chart: its `by_category` totals
 * are not bucketed and its `buckets` are category-agnostic, so a per-category
 * time series has no expressible summary shape yet.
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
  const range = useMemo(() => trendRange(period), [period]);
  // A null range keeps SWR idle until the user picks a category.
  const movements = useMovementsRange(selected ? range : null);
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
  // Real totals of the rendered buckets, never the chart's annotated peak.
  const expenseTotal = rows.reduce((sum, row) => sum + Number(row.expense), 0);
  const incomeTotal = rows.reduce((sum, row) => sum + Number(row.income), 0);
  const rangeLabel = trendRangeLabel(period, locale);
  const money = (value: number) => formatMoney(value, { locale, currency });
  return (
    <DeckCard
      title={t("finance.categoryChartTitle")}
      hint={t("finance.categoryChartHint")}
      className="col-span-12"
      headerClassName={deck.sectionHeaderWrap}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <label className="flex w-full max-w-md flex-col gap-1 text-xs text-muted">
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
          <DeckEmptyState
            icon={<CalendarActionIcon className="h-5 w-5 text-sky-400/70" />}
            title={t("finance.chartEmpty")}
            hint={t("finance.chartEmptyHint")}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {/* D8: the frame restyles the Recharts plot (hair grid, no axis
                lines, no built-in legend) and keeps the real tooltip. */}
            <div className={chartDeckFrameClass}>
              <CategoryTrendChart data={rows} series={series} locale={locale} currency={currency} />
            </div>
            <div className={deck.chartLegendRow}>
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className={deck.legendSwatchGlow} />
                <span className="text-slate-300">
                  {t("finance.chartExpenses")}:{" "}
                  <strong className="font-mono font-semibold text-sky-400">
                    {money(expenseTotal)}
                  </strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className={deck.legendSwatchFlow} />
                <span className="text-slate-300">
                  {t("finance.chartIncome")}:{" "}
                  <strong className="font-mono font-semibold text-emerald-400">
                    {money(incomeTotal)}
                  </strong>
                </span>
              </div>
              {rangeLabel ? (
                <span className={`ml-auto ${deck.chartRangeLabel}`}>{rangeLabel}</span>
              ) : null}
            </div>
            {noDataInRange ? (
              <p className="text-xs text-muted">{t("finance.trendNoDataInRange")}</p>
            ) : null}
          </div>
        )}
        <div className={deck.cardFooterRow}>
          <Link href="/dashboard/finance/compare/" className={deck.cardFooterLink}>
            <QueryStatsIcon className="h-4 w-4" />
            {t("finance.compareButton")}
          </Link>
        </div>
      </div>
    </DeckCard>
  );
}
