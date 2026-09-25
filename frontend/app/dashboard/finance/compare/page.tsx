"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { SectionShell } from "@/components/finance/FinanceSections";
import { CategoryBars } from "@/components/finance/CategoryCharts";
import { t } from "@/lib/i18n";
import { getToken } from "@/lib/api/client";
import { useAccounts, usePreferences } from "@/lib/api/dashboard";
import { useCategories, useMovements } from "@/lib/api/finance";
import { toCategoryMovementTotals, toCategoryOptions } from "@/lib/finance/finance";

const selectClass =
  "w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument focus:border-signal focus:outline-none";

/**
 * Standalone two-category comparison sourced from `GET /movements` (same
 * `finance/movements` SWR key as Finance, no new endpoint). Each category
 * shows expense and income side by side as separate figures — never netted,
 * never currency-mixed (single-currency guard in `toCategoryMovementTotals`).
 * A Finance sub-route reached only through the chart button — there is
 * intentionally no nav entry for this route.
 */
export default function ComparePage() {
  const router = useRouter();
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");

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

  const totalsA = first
    ? toCategoryMovementTotals(movements.data, currencyByAccountId, currency, first)
    : null;
  const totalsB = second
    ? toCategoryMovementTotals(movements.data, currencyByAccountId, currency, second)
    : null;
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
            {showHint ? (
              <p className="text-xs text-signal">{t("compare.sameHint")}</p>
            ) : totalsA && totalsB ? (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  <h3 className="font-display text-sm font-semibold">
                    {options.find((c) => c.id === first)?.name ?? first}
                  </h3>
                  <div className="mt-2">
                    <CategoryBars
                      expense={totalsA.expense}
                      income={totalsA.income}
                      locale={locale}
                      currency={currency}
                    />
                  </div>
                </div>
                <div>
                  <h3 className="font-display text-sm font-semibold">
                    {options.find((c) => c.id === second)?.name ?? second}
                  </h3>
                  <div className="mt-2">
                    <CategoryBars
                      expense={totalsB.expense}
                      income={totalsB.income}
                      locale={locale}
                      currency={currency}
                    />
                  </div>
                </div>
              </div>
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
