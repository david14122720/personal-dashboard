"use client";

import { useMemo, useState } from "react";
import { t } from "@/lib/i18n";
import { useAccounts } from "@/lib/api/dashboard";
import { useMovementsRange } from "@/lib/api/finance";
import {
  toAccountOptions,
  toAccountTrend,
  trendRange,
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
import { trendRangeLabel } from "@/components/finance/CategoryCharts";
import { formatMoney } from "@/lib/api/money";

// Canonical field string from the UI-polish contract (`design.md`), identical
// to the categories block.
const selectClass =
  "min-h-11 w-full rounded-lg border border-hair bg-card px-3 text-xs text-instrument transition-colors focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/30";

/**
 * Per-account gasto/ingreso trend, an exact UI/layout replica of
 * `CategoryChartSection`: same selector + period pills + line chart + bottom
 * counters, sourced from the ranged `GET /movements` read
 * (`useMovementsRange(trendRange(period))`) and fetched only once an account
 * is selected. The account list comes from `GET /accounts` (`useAccounts`),
 * mirroring how the categories block wires its own currency map.
 * `toAccountTrend` applies the exact same rules as `toCategoryTrend`: fixed
 * consecutive buckets, transfers are neither expense nor income, and only
 * movements in the user currency participate. The categories block's
 * "Comparar" footer is intentionally not replicated: there is no per-account
 * compare route to link to (A3).
 */
export function AccountChartSection({
  locale,
  currency,
}: {
  locale: string;
  currency: string;
}) {
  const [selected, setSelected] = useState("");
  const [period, setPeriod] = useState<TrendPeriod>("month");
  const range = useMemo(() => trendRange(period), [period]);
  // A null range keeps SWR idle until the user picks an account.
  const movements = useMovementsRange(selected ? range : null);
  const accounts = useAccounts();
  const currencyByAccountId = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a.currency])),
    [accounts.data],
  );
  const accountOptions = useMemo(() => toAccountOptions(accounts.data), [accounts.data]);
  const buckets = useMemo(
    () =>
      selected
        ? toAccountTrend(movements.data, {
            accountId: selected,
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
      title={t("finance.accountChartTitle")}
      hint={t("finance.accountChartHint")}
      className="col-span-12"
      headerClassName={deck.sectionHeaderWrap}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <label className="flex w-full max-w-md flex-col gap-1 text-xs text-muted">
            {t("finance.accountSelectLabel")}
            <select
              aria-label={t("finance.accountSelectLabel")}
              className={selectClass}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">{t("finance.selectAccount")}</option>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <TrendPeriodSelector value={period} onChange={setPeriod} name="account-trend-period" />
        </div>
        {buckets === null ? (
          <DeckEmptyState
            icon={<CalendarActionIcon className="h-5 w-5 text-sky-400/70" />}
            title={t("finance.accountChartEmpty")}
            hint={t("finance.accountChartEmptyHint")}
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
      </div>
    </DeckCard>
  );
}
