"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/api/money";
import { toCategoryTotals, type NamedOption } from "@/lib/finance/finance";
import type { SavingsGoalWire, SubscriptionWire } from "@/lib/api/finance";
import { SectionShell } from "@/components/finance/FinanceSections";
import EmptyState from "@/components/ui/EmptyState";

const selectClass =
  "w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument focus:border-signal focus:outline-none";

/** Two labeled bars (gastos vs ahorro) with amounts, no chart dependency. */
export function CategoryBars({
  expenses,
  savings,
  locale,
  currency,
}: {
  expenses: number;
  savings: number;
  locale: string;
  currency: string;
}) {
  const max = Math.max(expenses, savings, 1);
  const rows = [
    { label: t("finance.chartExpenses"), value: expenses, className: "bg-signal" },
    { label: t("finance.chartSavings"), value: savings, className: "bg-flow" },
  ];
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.label}>
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
 * Per-category gastos/ahorro chart (P7). The compare view (P8) lives on its
 * own page and is reached only through the button below — never the nav.
 */
export function CategoryChartSection({
  categories,
  subs,
  goals,
  locale,
  currency,
}: {
  categories: NamedOption[];
  subs: SubscriptionWire[];
  goals: SavingsGoalWire[];
  locale: string;
  currency: string;
}) {
  const [selected, setSelected] = useState("");
  const totals = useMemo(
    () => (selected ? toCategoryTotals(subs, goals, selected) : null),
    [subs, goals, selected],
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
        ) : totals.expenses === 0 && totals.savings === 0 ? (
          <EmptyState title={t("finance.chartEmpty")} hint={t("finance.chartEmptyHint")} />
        ) : (
          <CategoryBars expenses={totals.expenses} savings={totals.savings} locale={locale} currency={currency} />
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
