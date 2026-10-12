"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { t } from "@/lib/i18n";
import { useAccounts, usePreferences } from "@/lib/api/dashboard";
import { useMovements } from "@/lib/api/finance";
import { formatMoney } from "@/lib/api/money";
import { toTotalTrend, type TrendPeriod } from "@/lib/finance/finance";
import { usePrefersReducedMotion } from "@/lib/dashboard/useReducedMotion";
import DashboardDisclosure from "@/components/dashboard/DashboardDisclosure";
import DeckPeriodPills from "@/components/dashboard/DeckPeriodPills";
import { chartDeckFrameClass } from "@/components/ui/chartTheme";
import { deck } from "@/components/ui/deckStyles";
import type { TrendRow, TrendSeries } from "@/components/finance/CategoryTrendChart";

const CategoryTrendChart = dynamic(() => import("@/components/finance/CategoryTrendChart"), {
  ssr: false,
  loading: () => (
    <p role="status" className="text-sm text-instrument/60">{t("common.loading")}</p>
  ),
});

/** SWR reads + memoized aggregation live in this panel only, so nothing
 * fetches or mounts until the disclosure is open. Currency comes from the
 * existing preference fallback and no conversion happens anywhere. */
function TotalTrendPanel({ period }: { period: TrendPeriod }) {
  const movements = useMovements();
  const accounts = useAccounts();
  const prefs = usePreferences();
  const reduced = usePrefersReducedMotion();
  const { mutate } = useSWRConfig();

  const currencyByAccountId = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a.currency])),
    [accounts.data],
  );
  const userCurrency = prefs.data?.preferences.currency_code ?? "COP";
  const locale = prefs.data?.preferences.locale ?? "es-CO";
  const buckets = useMemo(
    () => toTotalTrend(movements.data, { period, currencyByAccountId, userCurrency }),
    [movements.data, currencyByAccountId, userCurrency, period],
  );
  const rows: TrendRow[] = useMemo(
    () =>
      buckets.map((bucket) => ({
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

  if (movements.isLoading || accounts.isLoading || prefs.isLoading) {
    return <p role="status" className="text-sm text-instrument/60">{t("common.loading")}</p>;
  }
  if (movements.error || accounts.error || prefs.error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm text-instrument/80">
        <p>{t("finance.movementsLoadFailed")}</p>
        <button
          type="button"
          onClick={() => {
            void mutate("finance/movements");
            void mutate("dashboard/accounts");
            void mutate("dashboard/me");
          }}
          className="inline-flex min-h-[44px] items-center rounded-md border border-hair px-4 py-2 font-display text-xs transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  const allZero = buckets.every((bucket) => bucket.expense === 0 && bucket.income === 0);
  // Real totals of the rendered buckets — the prototype's legend row never
  // repeats a hardcoded figure (D10).
  const expenseTotal = buckets.reduce((sum, bucket) => sum + bucket.expense, 0);
  const incomeTotal = buckets.reduce((sum, bucket) => sum + bucket.income, 0);
  const money = (value: number) => formatMoney(value, { locale, currency: userCurrency });
  return (
    <div className="flex flex-col gap-4">
      <div className={chartDeckFrameClass} data-testid="trend-chart-frame">
        <CategoryTrendChart
          data={rows}
          series={series}
          locale={locale}
          currency={userCurrency}
          ariaLabel={t("dashboard.totalTrendChartLabel")}
          animate={!reduced}
        />
      </div>
      {allZero ? (
        <p className="text-xs text-instrument/60">
          {t("dashboard.totalTrendEmpty", { currency: userCurrency })}
        </p>
      ) : null}
      <div className={deck.chartLegendRow}>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className={deck.legendSwatchGlow} />
          <span className="text-slate-300">
            {t("finance.chartExpenses")}:{" "}
            <strong className="font-mono font-semibold text-sky-400">{money(expenseTotal)}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className={deck.legendSwatchFlow} />
          <span className="text-slate-300">
            {t("finance.chartIncome")}:{" "}
            <strong className="font-mono font-semibold text-emerald-400">{money(incomeTotal)}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}

const PANEL_ID = "dashboard-total-trend-panel";

/** Independently collapsible totals trend: category-free expense/income series
 * per period bucket. The section owns `open`/`period`, so collapsing keeps the
 * selected period and `aria-controls` always resolves. Open by default: the
 * prototype draws this card expanded (`dashboard-desktop.html:334-437`). */
export default function TotalTrendSection({ className }: { className?: string } = {}) {
  const [open, setOpen] = useState(true);
  const [period, setPeriod] = useState<TrendPeriod>("month");
  return (
    <DashboardDisclosure
      title={t("dashboard.totalTrendTitle")}
      hint={t("dashboard.totalTrendHint")}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      panelId={PANEL_ID}
      className={className}
    >
      <div className="flex flex-col gap-4">
        <DeckPeriodPills
          name="dashboard-total-trend-period"
          label={t("dashboard.totalTrendPeriodLabel")}
          value={period}
          onChange={setPeriod}
        />
        <TotalTrendPanel period={period} />
      </div>
    </DashboardDisclosure>
  );
}
