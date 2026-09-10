"use client";

import EmptyState from "@/components/ui/EmptyState";
import { formatMoney, toNumber } from "@/lib/api/money";
import {
  toInsights,
  type BudgetInsightLike,
  type CategoryTotalLike,
  type FlowLike,
} from "@/lib/finance/finance";
import { formatMonth, t } from "@/lib/i18n";

export interface AnalysisSectionProps {
  flow: FlowLike[];
  byCatExpense: CategoryTotalLike[];
  byCatIncome: CategoryTotalLike[];
  budgets: BudgetInsightLike[];
  descriptions?: string[];
  locale?: string;
  currency?: string;
}

/**
 * Análisis FE-only: insights directos (plantillas ES `analysis.tpl*`) + métricas
 * + disclaimer fijo siempre visible. Sin datos → EmptyState + disclaimer.
 * Respeta reduced-motion (sin animación) y foco teclado (wrapper focusable).
 */
export default function AnalysisSection({
  flow,
  byCatExpense,
  byCatIncome,
  budgets,
  descriptions,
  locale = "es-CO",
  currency = "COP",
}: AnalysisSectionProps) {
  const disclaimer = <p className="mt-4 text-xs text-instrument/60">{t("analysis.disclaimer")}</p>;
  if (!flow || flow.length === 0) {
    return (
      <div
        tabIndex={0}
        aria-label={t("analysis.title")}
        className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
      >
        <EmptyState title={t("analysis.empty")} hint={t("analysis.emptyHint")} />
        {disclaimer}
      </div>
    );
  }
  const insights = toInsights({ flow, byCatExpense, byCatIncome, budgets, descriptions });
  const fmt = (value: string | number): string => formatMoney(value, { locale, currency });
  const fmtMonth = (month: string): string => formatMonth(month, locale);
  const lines = insights.map((insight) => {
    const v = insight.vars;
    switch (insight.kind) {
      case "mom-expense":
      case "mom-expense-up":
      case "mom-expense-down":
      case "mom-expense-flat": {
        // JD-INSIGHT: plantilla por dirección (dir o kind); up → tplMom intacta.
        const dir =
          v.dir !== undefined
            ? String(v.dir)
            : insight.kind === "mom-expense-down"
              ? "down"
              : insight.kind === "mom-expense-flat"
                ? "flat"
                : "up";
        if (dir === "down")
          return t("analysis.tplMomDown", {
            pct: String(v.pct),
            cat: String(v.cat),
            cur: fmt(v.cur),
            prev: fmt(v.prev),
          });
        if (dir === "flat")
          return t("analysis.tplMomFlat", {
            pct: String(v.pct),
            cat: String(v.cat),
            cur: fmt(v.cur),
            prev: fmt(v.prev),
          });
        return t("analysis.tplMom", {
          pct: String(v.pct),
          cat: String(v.cat),
          cur: fmt(v.cur),
          prev: fmt(v.prev),
        });
      }
      case "savings-rate":
        return t("analysis.tplSavings", { n: String(v.n), saved: fmt(v.saved), income: fmt(v.income) });
      case "worst-month":
        return t("analysis.tplWorst", { mes: fmtMonth(String(v.mes)), amount: fmt(v.amount) });
      case "best-month":
        return t("analysis.tplBest", { mes: fmtMonth(String(v.mes)), amount: fmt(v.amount) });
      case "avg-expense":
        return t("analysis.tplAvg", { amount: fmt(v.amount) });
      case "budget":
        return t("analysis.tplBudget", {
          n: String(v.n),
          label: String(v.label),
          spent: fmt(v.spent),
          amount: fmt(v.amount),
        });
      case "recurrent":
        return t("analysis.tplRecurrent", { name: String(v.name), count: String(v.count) });
      default:
        return "";
    }
  });
  const last = flow[flow.length - 1];
  const lastIncome = toNumber(last.income);
  const lastExpense = toNumber(last.expense);
  const rate = lastIncome > 0 ? `${Math.round(((lastIncome - lastExpense) / lastIncome) * 100)}%` : "—";
  const avg = Math.round(flow.reduce((sum, row) => sum + toNumber(row.expense), 0) / flow.length);
  const top = [...(byCatExpense ?? [])].sort((a, b) => toNumber(b.total) - toNumber(a.total))[0];
  return (
    <div
      tabIndex={0}
      aria-label={t("analysis.title")}
      className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
    >
      <dl className="grid grid-cols-2 gap-2 text-xs text-instrument/70 md:grid-cols-3">
        <div className="rounded-lg border border-hull px-3 py-2">
          <dt>{t("analysis.savingsRate")}</dt>
          <dd className="mt-0.5 font-mono text-sm tabular-nums text-instrument">{rate}</dd>
        </div>
        <div className="rounded-lg border border-hull px-3 py-2">
          <dt>{t("analysis.avgExpense")}</dt>
          <dd className="mt-0.5 font-mono text-sm tabular-nums text-instrument">{fmt(avg)}</dd>
        </div>
        <div className="rounded-lg border border-hull px-3 py-2">
          <dt>{t("analysis.topCategory")}</dt>
          <dd className="mt-0.5 truncate text-sm text-instrument">{top ? top.name : "—"}</dd>
        </div>
      </dl>
      <ul className="mt-4 flex flex-col gap-2">
        {lines.map((line, index) => (
          <li key={insights[index].id} className="rounded-lg border border-hull px-3 py-2 text-sm">
            {line}
          </li>
        ))}
      </ul>
      {disclaimer}
    </div>
  );
}
