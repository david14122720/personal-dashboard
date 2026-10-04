"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { t } from "@/lib/i18n";
import { useAccounts, usePreferences } from "@/lib/api/dashboard";
import { useCategories, useMovements } from "@/lib/api/finance";
import {
  currentPeriodRange,
  toExpenseByCategory,
  type TrendPeriod,
} from "@/lib/finance/finance";
import { usePrefersReducedMotion } from "@/lib/dashboard/useReducedMotion";
import DashboardDisclosure from "@/components/dashboard/DashboardDisclosure";
import TrendPeriodSelector from "@/components/finance/TrendPeriodSelector";

const ExpenseCategoryPieChart = dynamic(
  () => import("@/components/dashboard/charts/ExpenseCategoryPieChart"),
  {
    ssr: false,
    loading: () => (
      <p role="status" className="text-sm text-instrument/60">{t("common.loading")}</p>
    ),
  },
);

/** SWR reads + memoized aggregation live in this panel only, so nothing
 * fetches or mounts until the disclosure is open. Category names are joined
 * from the API-backed `finance/categories` read; local-only ids never render.
 * Currency comes from the existing preference fallback and is never converted. */
function ExpensePiePanel({ period }: { period: TrendPeriod }) {
  const movements = useMovements();
  const accounts = useAccounts();
  const categories = useCategories();
  const prefs = usePreferences();
  const reduced = usePrefersReducedMotion();
  const { mutate } = useSWRConfig();

  const currencyByAccountId = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a.currency])),
    [accounts.data],
  );
  const userCurrency = prefs.data?.preferences.currency_code ?? "COP";
  const locale = prefs.data?.preferences.locale ?? "es-CO";
  const slices = useMemo(
    () =>
      toExpenseByCategory(movements.data, {
        range: currentPeriodRange(period),
        categories: categories.data,
        currencyByAccountId,
        userCurrency,
      }),
    [movements.data, categories.data, currencyByAccountId, userCurrency, period],
  );

  if (movements.isLoading || accounts.isLoading || categories.isLoading || prefs.isLoading) {
    return <p role="status" className="text-sm text-instrument/60">{t("common.loading")}</p>;
  }
  if (movements.error || accounts.error || categories.error || prefs.error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm text-instrument/80">
        <p>{t("finance.movementsLoadFailed")}</p>
        <button
          type="button"
          onClick={() => {
            void mutate("finance/movements");
            void mutate("dashboard/accounts");
            void mutate("finance/categories");
            void mutate("dashboard/me");
          }}
          className="inline-flex min-h-[44px] items-center rounded-md border border-hull px-4 py-2 font-display text-xs transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  return (
    <ExpenseCategoryPieChart
      data={slices}
      locale={locale}
      currency={userCurrency}
      ariaLabel={t("dashboard.expensePieChartLabel")}
      animate={!reduced}
    />
  );
}

const PANEL_ID = "dashboard-expense-pie-panel";

/** Independently collapsible expense-by-category pie scoped to the current
 * period. The section owns `open`/`period` and a radio group named apart from
 * the totals trend, so collapsing keeps the selected period and toggling one
 * disclosure never moves the other. */
export default function ExpensePieSection() {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<TrendPeriod>("month");
  return (
    <DashboardDisclosure
      title={t("dashboard.expensePieTitle")}
      hint={t("dashboard.expensePieHint")}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      panelId={PANEL_ID}
    >
      <div className="flex flex-col gap-4">
        <TrendPeriodSelector
          name="dashboard-expense-pie-period"
          label={t("dashboard.expensePiePeriodLabel")}
          value={period}
          onChange={setPeriod}
        />
        <ExpensePiePanel period={period} />
      </div>
    </DashboardDisclosure>
  );
}
