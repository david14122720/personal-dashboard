"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { t } from "@/lib/i18n";
import { useAccounts, usePreferences } from "@/lib/api/dashboard";
import { useMovements } from "@/lib/api/finance";
import { toTotalTrend, type TrendPeriod } from "@/lib/finance/finance";
import { usePrefersReducedMotion } from "@/lib/dashboard/useReducedMotion";
import DashboardDisclosure from "@/components/dashboard/DashboardDisclosure";
import TrendPeriodSelector from "@/components/finance/TrendPeriodSelector";
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
          className="inline-flex min-h-[44px] items-center rounded-md border border-hull px-4 py-2 font-display text-xs transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  const allZero = buckets.every((bucket) => bucket.expense === 0 && bucket.income === 0);
  return (
    <div className="flex flex-col gap-2">
      <CategoryTrendChart
        data={rows}
        series={series}
        locale={locale}
        currency={userCurrency}
        ariaLabel={t("dashboard.totalTrendChartLabel")}
        animate={!reduced}
      />
      {allZero ? (
        <p className="text-xs text-instrument/60">
          {t("dashboard.totalTrendEmpty", { currency: userCurrency })}
        </p>
      ) : null}
    </div>
  );
}

const PANEL_ID = "dashboard-total-trend-panel";

/** Independently collapsible totals trend: category-free expense/income series
 * per period bucket. The section owns `open`/`period`, so collapsing keeps the
 * selected period and `aria-controls` always resolves. */
export default function TotalTrendSection() {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<TrendPeriod>("month");
  return (
    <DashboardDisclosure
      title={t("dashboard.totalTrendTitle")}
      hint={t("dashboard.totalTrendHint")}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      panelId={PANEL_ID}
    >
      <div className="flex flex-col gap-4">
        <TrendPeriodSelector
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
