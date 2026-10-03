"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { SectionShell } from "@/components/finance/FinanceSections";
import CategoryTrendChart, {
  type TrendRow,
  type TrendSeries,
} from "@/components/finance/CategoryTrendChart";
import TrendPeriodSelector from "@/components/finance/TrendPeriodSelector";
import { t } from "@/lib/i18n";
import { getToken } from "@/lib/api/client";
import { useAccounts, usePreferences } from "@/lib/api/dashboard";
import { useCategories, useMovements } from "@/lib/api/finance";
import { toCategoryOptions, toCategoryTrend, type TrendPeriod } from "@/lib/finance/finance";

const selectClass =
  "w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument focus:border-signal focus:outline-none";

/**
 * Standalone two-category comparison sourced from `GET /movements` (same
 * `finance/movements` SWR key as Finance, no new endpoint). Both categories
 * are bucketed over the same period (`toCategoryTrend`) and merged by bucket
 * index into one four-line trend: expense and income per category, never
 * netted, never currency-mixed (single-currency guard in `toCategoryTrend`).
 * Category A is solid and category B is dashed, so line style — not only
 * color — separates the two categories. A Finance sub-route reached only
 * through the chart button — there is intentionally no nav entry.
 */
export default function ComparePage() {
  const router = useRouter();
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [period, setPeriod] = useState<TrendPeriod>("month");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login/");
    }
  }, [router]);

  const prefs = usePreferences();
  const categories = useCategories();
  const movements = useMovements();
  const accounts = useAccounts();

  const locale = prefs.data?.preferences.locale ?? "es-CO";
  const currency = prefs.data?.preferences.currency_code ?? "COP";

  // Single unfiltered category set: every owned category together, no
  // kind split, no badge, no filter.
  const options = useMemo(
    () => toCategoryOptions(categories.data ?? []),
    [categories.data],
  );

  const currencyByAccountId = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a.currency])),
    [accounts.data],
  );

  const rows: TrendRow[] = useMemo(() => {
    if (!first || !second) return [];
    const trendA = toCategoryTrend(movements.data, {
      categoryId: first,
      period,
      currencyByAccountId,
      userCurrency: currency,
    });
    const trendB = toCategoryTrend(movements.data, {
      categoryId: second,
      period,
      currencyByAccountId,
      userCurrency: currency,
    });
    return trendA.map((bucket, index) => ({
      bucket: bucket.bucket,
      label: bucket.label,
      a_expense: bucket.expense,
      a_income: bucket.income,
      b_expense: trendB[index].expense,
      b_income: trendB[index].income,
    }));
  }, [first, second, movements.data, currencyByAccountId, currency, period]);

  const nameA = options.find((c) => c.id === first)?.name ?? first;
  const nameB = options.find((c) => c.id === second)?.name ?? second;
  const series: TrendSeries[] = [
    {
      key: "a_expense",
      label: t("finance.trendExpensesOf", { name: nameA }),
      token: "--color-signal",
    },
    {
      key: "a_income",
      label: t("finance.trendIncomeOf", { name: nameA }),
      token: "--color-flow",
    },
    {
      key: "b_expense",
      label: t("finance.trendExpensesOf", { name: nameB }),
      token: "--color-alert",
      dashed: true,
    },
    {
      key: "b_income",
      label: t("finance.trendIncomeOf", { name: nameB }),
      token: "--color-violet",
      dashed: true,
    },
  ];
  const showHint = first !== "" && first === second;

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header>
          <h1 className="font-display text-2xl font-semibold tracking-wide">{t("compare.title")}</h1>
          <p className="mt-1 text-sm text-instrument/70">{t("compare.hint")}</p>
        </header>
        <SectionShell title={t("compare.title")} span="">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-instrument/60">
              {t("compare.selectA")}
              <select
                aria-label={t("compare.selectA")}
                className={selectClass}
                value={first}
                onChange={(e) => setFirst(e.target.value)}
              >
                <option value="">{t("finance.selectCategory")}</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-instrument/60">
              {t("compare.selectB")}
              <select
                aria-label={t("compare.selectB")}
                className={selectClass}
                value={second}
                onChange={(e) => setSecond(e.target.value)}
              >
                <option value="">{t("finance.selectCategory")}</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4">
            <TrendPeriodSelector value={period} onChange={setPeriod} />
          </div>
          <div className="mt-4">
            {showHint ? (
              <p className="text-xs text-signal">{t("compare.sameHint")}</p>
            ) : first && second ? (
              <CategoryTrendChart
                data={rows}
                series={series}
                locale={locale}
                currency={currency}
              />
            ) : (
              <p className="text-xs text-instrument/60">{t("finance.chartEmptyHint")}</p>
            )}
          </div>
        </SectionShell>
        <div>
          <Link
            href="/dashboard/finance/"
            className="inline-flex items-center rounded-lg border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
          >
            {t("compare.backToFinance")}
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
