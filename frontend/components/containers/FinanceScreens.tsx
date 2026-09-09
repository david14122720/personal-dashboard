"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useSWRConfig } from "swr";
import AppShell from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import TransactionsLedger from "@/components/finance/TransactionsLedger";
import TransferHistory from "@/components/finance/TransferHistory";
import { ManualCaptureSection } from "@/components/finance/ManualCapture";
import {
  AccountsList,
  BudgetsList,
  CompactMoneyList,
  SavingsList,
  SectionShell,
} from "@/components/finance/FinanceSections";
import {
  useAccounts,
  useBudgets,
  useMonthlyFlow,
  useNetWorth,
  usePreferences,
  useSpendByCategory,
  type BudgetWire,
} from "@/lib/api/dashboard";
import {
  useAssets,
  useDebts,
  useFinanceCategories,
  useSavingsGoals,
  useSubscriptions,
  type SavingsGoalWire,
  type SubscriptionWire,
} from "@/lib/api/finance";
import {
  toAccountCards,
  toAccountOptions,
  toBalanceSeries,
  toBudgetViews,
  toCategoryOptions,
  toDebtRows,
  toExpenseSeries,
  toPeriodRange,
  toSavingsSeries,
  toSavingsViews,
  toSubscriptionRows,
  type PeriodSel,
} from "@/lib/finance/finance";
import { toDonutSlices } from "@/lib/dashboard/transforms";
import { usePrefersReducedMotion } from "@/lib/dashboard/useReducedMotion";
import { formatMoney, toNumber } from "@/lib/api/money";
import BudgetForm from "@/components/finance/BudgetForm";
import { SavingsDepositForm, SavingsGoalForm } from "@/components/finance/SavingsForms";
import { DebtEditForm, DebtPayForm, DebtPaymentHistory, DebtProgressBar } from "@/components/finance/DebtPayments";
import { SubscriptionCreateForm, SubscriptionRow } from "@/components/finance/SubscriptionForms";
import CardForm from "@/components/finance/CardForm";
import { CardDetail } from "@/components/finance/CardDetail";
import { AssetEditForm, AssetValuationForm } from "@/components/finance/AssetForms";
import PeriodSelector from "@/components/finance/PeriodSelector";
import AnalysisSection from "@/components/finance/AnalysisSection";

/**
 * Finance screens container. Owns all aggregate SWR reads (fired in
 * parallel) and money coercion at the boundary; `components/finance/*`
 * sections stay pure. The ledger manages its own keyset pagination below.
 */

const BalanceChart = dynamic(() => import("@/components/ui/BalanceChart"), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

const SavingsChart = dynamic(() => import("@/components/ui/SavingsChart"), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

const MonthlyExpensesChart = dynamic(() => import("@/components/ui/MonthlyExpensesChart"), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

const MonthCompareChart = dynamic(() => import("@/components/ui/MonthCompareChart"), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

const CategoryDonut = dynamic(() => import("@/components/ui/CategoryDonut"), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

function ChartSkeleton() {
  return (
    <div role="status" aria-label={t("common.loading")} className="flex h-40 items-center justify-center">
      <p className="text-sm text-instrument/50">{t("common.loading")}</p>
    </div>
  );
}

function AggregatesSkeleton() {
  return (
    <div role="status" aria-label={t("finance.loadingSections")} aria-busy="true" className="grid grid-cols-12 gap-4">
      {[0, 1, 2].map((n) => (
        <div
          key={n}
          className="col-span-12 animate-pulse rounded-xl border border-hull bg-hull/40 p-5 md:col-span-6"
        >
          <div className="h-4 w-24 rounded bg-hull" />
          <div className="mt-3 h-8 w-32 rounded bg-hull" />
        </div>
      ))}
    </div>
  );
}

export default function FinanceScreens() {
  const { mutate } = useSWRConfig();
  const reducedMotion = usePrefersReducedMotion();

  const budgets = useBudgets();
  const accounts = useAccounts();
  const subscriptions = useSubscriptions();
  const debts = useDebts();
  const savings = useSavingsGoals();
  const prefs = usePreferences();
  // S5 (no bloquean el skeleton ni el alert de agregados S1).
  const categories = useFinanceCategories();
  const assets = useAssets();
  const netWorth = useNetWorth();

  // S6: período default mes actual → from/to alimentan ambos agregados.
  const [period, setPeriod] = useState<PeriodSel>({ kind: "month" });
  const now = new Date();
  let range: { from: string; to: string } | null = null;
  try {
    range = toPeriodRange(period, now);
  } catch {
    range = null;
  }
  const monthlyFlow = useMonthlyFlow(range?.from ?? null, range?.to ?? null);
  const spendExpense = useSpendByCategory(range?.from ?? null, range?.to ?? null, "expense");
  const spendIncome = useSpendByCategory(range?.from ?? null, range?.to ?? null, "income");

  const queries = [budgets, accounts, subscriptions, debts, savings, prefs];
  const isLoading = queries.some((q) => q.isLoading);
  const failed = queries.filter((q) => q.error);

  const locale = prefs.data?.preferences.locale ?? "es-CO";
  const currency = prefs.data?.preferences.currency_code ?? "COP";

  const flowRows = monthlyFlow.data ?? [];
  const balanceData = toBalanceSeries(flowRows);
  const savingsData = toSavingsSeries(flowRows);
  const expensesData = toExpenseSeries(flowRows);
  const incomeSlices = toDonutSlices(spendIncome.data);
  const animate = !reducedMotion;

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-wide">{t("finance.title")}</h1>
      <p className="mt-1 text-sm text-instrument/60">
        {t("finance.subtitle", { currency })}
      </p>
      <div className="mt-6 grid grid-cols-12 gap-4">
        <div className="col-span-12">
          <ManualCaptureSection />
        </div>
        <div className="col-span-12">
          <TransactionsLedger locale={locale} />
        </div>
        <div className="col-span-12">
          <TransferHistory locale={locale} />
        </div>
        {isLoading ? (
          <div className="col-span-12">
            <AggregatesSkeleton />
          </div>
        ) : failed.length > 0 ? (
          <div className="col-span-12">
            <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-5">
              <h2 className="font-display text-lg font-semibold">{t("finance.loadFailed")}</h2>
              <p className="mt-1 text-sm text-instrument/70">
                {t("finance.loadFailedDetail", { failed: failed.length, total: queries.length })}
              </p>
              <button
                type="button"
                onClick={() =>
                  void mutate(
                    (key) =>
                      typeof key === "string" &&
                      (key.startsWith("finance/") || key.startsWith("dashboard/")),
                  )
                }
                className="mt-4 rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
              >
                {t("common.retry")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <SectionShell
              title={t("finance.budgets")}
              hint={t("finance.budgetsHint")}
              span="col-span-12 xl:col-span-7"
            >
              <BudgetsList budgets={toBudgetViews(budgets.data)} locale={locale} />
            </SectionShell>
            <SectionShell
              title={t("finance.accounts")}
              hint={t("finance.accountsHint")}
              span="col-span-12 xl:col-span-5"
            >
              <AccountsList accounts={toAccountCards(accounts.data)} locale={locale} />
            </SectionShell>
            <SectionShell
              title={t("finance.subscriptions")}
              hint={t("finance.subscriptionsHint")}
              span="col-span-12 md:col-span-6 xl:col-span-4"
            >
              <CompactMoneyList
                rows={toSubscriptionRows(subscriptions.data)}
                locale={locale}
                emptyTitle={t("finance.noSubscriptions")}
                emptyHint={t("finance.noSubscriptionsHint")}
              />
            </SectionShell>
            <SectionShell
              title={t("finance.debts")}
              hint={t("finance.debtsHint")}
              span="col-span-12 md:col-span-6 xl:col-span-4"
            >
              <CompactMoneyList
                rows={toDebtRows(debts.data)}
                locale={locale}
                emptyTitle={t("finance.noDebts")}
                emptyHint={t("finance.noDebtsHint")}
              />
            </SectionShell>
            <SectionShell
              title={t("finance.savings")}
              hint={t("finance.savingsHint")}
              span="col-span-12 xl:col-span-4"
            >
              <SavingsList goals={toSavingsViews(savings.data)} locale={locale} />
            </SectionShell>
            <S5Sections categories={toCategoryOptions(categories.data ?? [])} accounts={toAccountOptions((accounts.data ?? []).map((row) => ({ id: row.id, name: row.name })))} budgets={budgets.data ?? []} subs={subscriptions.data ?? []} debts={debts.data ?? []} savings={savings.data ?? []} cards={toAccountCards(accounts.data)} assets={assets.data ?? []} netWorth={netWorth.data ?? null} currency={currency} locale={locale} />
            <SectionShell title={t("charts.periodLabel")} span="col-span-12">
              <PeriodSelector value={period} onChange={setPeriod} now={now} />
            </SectionShell>
            <SectionShell title={t("charts.balance")} hint={t("charts.balanceHint")} span="col-span-12 xl:col-span-6">
              <BalanceChart data={balanceData} animate={animate} />
            </SectionShell>
            <SectionShell title={t("charts.savings")} hint={t("charts.savingsHint")} span="col-span-12 xl:col-span-6">
              <SavingsChart data={savingsData} animate={animate} />
            </SectionShell>
            <SectionShell title={t("charts.monthlyExpenses")} hint={t("charts.monthlyExpensesHint")} span="col-span-12 xl:col-span-6">
              <MonthlyExpensesChart data={expensesData} animate={animate} />
            </SectionShell>
            <SectionShell title={t("charts.monthCompare")} hint={t("charts.monthCompareHint")} span="col-span-12 xl:col-span-6">
              <MonthCompareChart data={flowRows} animate={animate} />
            </SectionShell>
            <SectionShell title={t("charts.incomeSource")} hint={t("charts.incomeSourceHint")} span="col-span-12 xl:col-span-6">
              <CategoryDonut data={incomeSlices} animate={animate} />
            </SectionShell>
            <SectionShell title={t("analysis.title")} hint={t("analysis.hint")} span="col-span-12 xl:col-span-6">
              <AnalysisSection
                flow={flowRows}
                byCatExpense={(spendExpense.data ?? []).map((row) => ({ name: row.name, total: row.total }))}
                byCatIncome={(spendIncome.data ?? []).map((row) => ({ name: row.name, total: row.total }))}
                budgets={(budgets.data ?? []).map((b) => ({
                  id: b.id,
                  label: `${b.currency} ${toNumber(b.amount).toFixed(0)} · ${b.period_start}`,
                  spent: toNumber(b.spent),
                  amount: toNumber(b.amount),
                  pct: Number.isFinite(b.pct) ? b.pct : 0,
                  status: b.status,
                }))}
                locale={locale}
                currency={currency}
              />
            </SectionShell>
          </>
        )}
      </div>
    </div>
  );
}

/* S5 escritura: 6 SectionShell ocultables tras las F1 intactas + patrimonio-número. */
/* Títulos propios (sin hints de lectura) para no duplicar copy S1. PR-3 FIX: filas */
/* SubscriptionRow + edición/borrado BudgetForm/SavingsGoalForm cableados a listas. */
function S5Sections({ categories, accounts, budgets, subs, debts, savings, cards, assets, netWorth, currency, locale }: { categories: { id: string; name: string }[]; accounts: { id: string; name: string }[]; budgets: BudgetWire[]; subs: SubscriptionWire[]; debts: { id: string; name: string; creditor: string; original_amount: string | number; pending_amount: string | number; currency: string }[]; savings: SavingsGoalWire[]; cards: { id: string; name: string; type: string; currency: string; balance: number; isCard: boolean; used: number | null; available: number | null; usagePct: number | null; alertLevel: string | null; statementBalance: number | null }[]; assets: { id: string; name: string }[]; netWorth: { per_currency: { currency: string; net_worth: string | number }[] } | null; currency: string; locale: string }) {
  const noop = (): void => undefined;
  const firstDebt = debts[0];
  const firstGoal = savings[0];
  const firstCard = cards.find((c) => c.isCard);
  const firstAsset = assets[0];
  const worth = netWorth?.per_currency.find((e) => e.currency === currency) ?? netWorth?.per_currency[0];
  return (
    <>
      <SectionShell title={t("finance.manageBudgets")} span="col-span-12 xl:col-span-6">
        <BudgetForm categories={categories} onDone={noop} />
        {budgets.map((b) => (
          <div key={b.id} className="mt-4 border-t border-hull pt-4">
            <BudgetForm
              categories={categories}
              budget={{
                id: b.id,
                category_id: b.category_id,
                amount: b.amount,
                period_start: b.period_start,
                period_end: b.period_end,
              }}
              onDone={noop}
            />
          </div>
        ))}
      </SectionShell>
      <SectionShell title={t("finance.manageSavings")} span="col-span-12 xl:col-span-6">
        <SavingsGoalForm categories={categories} onDone={noop} />
        {savings.map((g) => (
          <div key={g.id} className="mt-4 border-t border-hull pt-4">
            <SavingsGoalForm
              categories={categories}
              goal={{
                id: g.id,
                name: g.name,
                description: g.description ?? null,
                target_amount: g.target_amount,
                target_date: g.target_date ?? null,
                category_id: g.category_id ?? null,
                color: g.color ?? null,
              }}
              onDone={noop}
            />
          </div>
        ))}
        {firstGoal ? (<div className="mt-4"><SavingsDepositForm goalId={firstGoal.id} saved={Number(firstGoal.saved_amount) || 0} currency={firstGoal.currency} onDone={noop} /></div>) : null}
      </SectionShell>
      <SectionShell title={t("finance.manageDebts")} span="col-span-12 xl:col-span-6">
        {firstDebt ? (<><DebtProgressBar original={Number(firstDebt.original_amount) || 0} pendingAmount={Number(firstDebt.pending_amount) || 0} /><div className="mt-4"><DebtPayForm debtId={firstDebt.id} pending={Number(firstDebt.pending_amount) || 0} currency={firstDebt.currency} onDone={noop} /></div><div className="mt-4"><DebtPaymentHistory debtId={firstDebt.id} onCorrect={noop} /></div><div className="mt-4"><DebtEditForm debtId={firstDebt.id} onDone={noop} /></div></>) : null}
      </SectionShell>
      <SectionShell title={t("finance.manageSubs")} span="col-span-12 xl:col-span-6">
        <SubscriptionCreateForm categories={categories} onDone={noop} />
        {subs.map((sub) => (
          <div key={sub.id} className="mt-2">
            <SubscriptionRow sub={sub} />
          </div>
        ))}
      </SectionShell>
      <SectionShell title={t("finance.manageCards")} span="col-span-12 xl:col-span-6">
        <CardForm onDone={noop} />
        {firstCard ? (<div className="mt-4"><CardDetail card={firstCard} locale={locale} /></div>) : null}
      </SectionShell>
      <SectionShell title={t("finance.manageAssets")} span="col-span-12 xl:col-span-6">
        {firstAsset ? (<><AssetEditForm assetId={firstAsset.id} accounts={accounts} onDone={noop} /><div className="mt-4"><AssetValuationForm assetId={firstAsset.id} onDone={noop} /></div></>) : null}
        <p className="mt-4 font-mono text-sm tabular-nums">{t("dashboard.netWorth")}: {worth ? formatMoney(worth.net_worth, { locale, currency: worth.currency }) : "—"}</p>
      </SectionShell>
    </>
  );
}

export function FinanceScreensShell() {
  return (
    <AppShell>
      <FinanceScreens />
    </AppShell>
  );
}
