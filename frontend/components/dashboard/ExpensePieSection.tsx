"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { t, type EsKey } from "@/lib/i18n";
import { usePreferences } from "@/lib/api/dashboard";
import { useCategories, useMovementsSummary } from "@/lib/api/finance";
import {
  currentPeriodRange,
  toSummaryExpenseSlices,
  toSummaryIncomeSlices,
  type TrendPeriod,
} from "@/lib/finance/finance";
import { usePrefersReducedMotion } from "@/lib/dashboard/useReducedMotion";
import DashboardDisclosure from "@/components/dashboard/DashboardDisclosure";
import DeckPeriodPills from "@/components/dashboard/DeckPeriodPills";
import { deck } from "@/components/ui/deckStyles";

/** Direction shown by the donut. `expense` is the prototype default; the
 * summary payload carries both fields, so switching never refetches. */
type PieMode = "expense" | "income";

const PIE_MODE_COPY: Record<
  PieMode,
  { title: EsKey; hint: EsKey; chartLabel: EsKey; empty: EsKey; pill: EsKey }
> = {
  expense: {
    title: "dashboard.expensePieTitle",
    hint: "dashboard.expensePieHint",
    chartLabel: "dashboard.expensePieChartLabel",
    empty: "dashboard.expensePieEmpty",
    pill: "dashboard.expensePieModeExpense",
  },
  income: {
    title: "dashboard.expensePieIncomeTitle",
    hint: "dashboard.expensePieIncomeHint",
    chartLabel: "dashboard.expensePieIncomeChartLabel",
    empty: "dashboard.expensePieIncomeEmpty",
    pill: "dashboard.expensePieModeIncome",
  },
};

const PIE_MODES: PieMode[] = ["expense", "income"];

/** [ Gastos | Ingresos ] segmented control, same track recipe as the period
 * pills so both controls read as one toolbar, with native radio semantics. */
function PieModeToggle({
  value,
  onChange,
}: {
  value: PieMode;
  onChange: (mode: PieMode) => void;
}) {
  return (
    <fieldset className="flex justify-start">
      <legend className="sr-only">{t("dashboard.expensePieModeLabel")}</legend>
      <div className={deck.segmentedTrack}>
        {PIE_MODES.map((mode) => (
          <label
            key={mode}
            className={`relative ${
              value === mode ? deck.segmentedActive : deck.segmentedInactive
            } inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center focus-within:ring-2 focus-within:ring-signal`}
          >
            <input
              type="radio"
              name="dashboard-expense-pie-mode"
              value={mode}
              checked={value === mode}
              onChange={() => onChange(mode)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            {t(PIE_MODE_COPY[mode].pill)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const ExpenseCategoryPieChart = dynamic(
  () => import("@/components/dashboard/charts/ExpenseCategoryPieChart"),
  {
    ssr: false,
    loading: () => (
      <p role="status" className="text-sm text-instrument/60">{t("common.loading")}</p>
    ),
  },
);

/** SWR reads live in this panel only, so nothing fetches or mounts until the
 * disclosure is open. The server summary already returns the current window's
 * per-category expenses with the single-currency rule applied (S1); this panel
 * only joins the API-backed category names (`finance/categories`), so
 * local-only ids never render and nothing is re-filtered or converted. */
function ExpensePiePanel({ period, mode }: { period: TrendPeriod; mode: PieMode }) {
  const range = useMemo(() => currentPeriodRange(period), [period]);
  const summary = useMovementsSummary({ ...range, group: period });
  const categories = useCategories();
  const prefs = usePreferences();
  const reduced = usePrefersReducedMotion();
  const { mutate } = useSWRConfig();

  const userCurrency = prefs.data?.preferences.currency_code ?? "COP";
  const locale = prefs.data?.preferences.locale ?? "es-CO";
  const slices = useMemo(
    () =>
      mode === "income"
        ? toSummaryIncomeSlices(summary.data, categories.data)
        : toSummaryExpenseSlices(summary.data, categories.data),
    [summary.data, categories.data, mode],
  );

  if (summary.isLoading || categories.isLoading || prefs.isLoading) {
    return <p role="status" className="text-sm text-instrument/60">{t("common.loading")}</p>;
  }
  if (summary.error || categories.error || prefs.error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm text-instrument/80">
        <p>{t("finance.movementsLoadFailed")}</p>
        <button
          type="button"
          onClick={() => {
            void mutate((key) => typeof key === "string" && key.startsWith("finance/movements"));
            void mutate("finance/categories");
            void mutate("dashboard/me");
          }}
          className="inline-flex min-h-[44px] items-center rounded-md border border-hair px-4 py-2 font-display text-xs transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
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
      ariaLabel={t(PIE_MODE_COPY[mode].chartLabel)}
      emptyText={t(PIE_MODE_COPY[mode].empty, { currency: userCurrency })}
      animate={!reduced}
    />
  );
}

const PANEL_ID = "dashboard-expense-pie-panel";

/** Independently collapsible category pie scoped to the current period, with
 * a [Gastos | Ingresos] toggle in its toolbar. The section owns
 * `open`/`period`/`mode` and every radio group has its own `name`, so
 * collapsing keeps the selected period and mode, and toggling one disclosure
 * never moves the other. Open by default, expenses by default: the prototype
 * draws this card expanded (`dashboard-desktop.html:554-612`). */
export default function ExpensePieSection({ className }: { className?: string } = {}) {
  const [open, setOpen] = useState(true);
  const [period, setPeriod] = useState<TrendPeriod>("month");
  const [mode, setMode] = useState<PieMode>("expense");
  return (
    <DashboardDisclosure
      title={t(PIE_MODE_COPY[mode].title)}
      hint={t(PIE_MODE_COPY[mode].hint)}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      panelId={PANEL_ID}
      className={className}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PieModeToggle value={mode} onChange={setMode} />
          <DeckPeriodPills
            name="dashboard-expense-pie-period"
            label={t("dashboard.expensePiePeriodLabel")}
            value={period}
            onChange={setPeriod}
          />
        </div>
        <ExpensePiePanel period={period} mode={mode} />
      </div>
    </DashboardDisclosure>
  );
}
