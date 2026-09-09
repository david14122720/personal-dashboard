"use client";

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
import { useAccounts, useBudgets, useNetWorth, usePreferences } from "@/lib/api/dashboard";
import { useAssets, useDebts, useFinanceCategories, useSavingsGoals, useSubscriptions } from "@/lib/api/finance";
import {
  toAccountCards,
  toAccountOptions,
  toBudgetViews,
  toCategoryOptions,
  toDebtRows,
  toSavingsViews,
  toSubscriptionRows,
} from "@/lib/finance/finance";
import { formatMoney } from "@/lib/api/money";
import BudgetForm from "@/components/finance/BudgetForm";
import { SavingsDepositForm, SavingsGoalForm } from "@/components/finance/SavingsForms";
import { DebtEditForm, DebtPayForm, DebtPaymentHistory, DebtProgressBar } from "@/components/finance/DebtPayments";
import { SubscriptionCreateForm } from "@/components/finance/SubscriptionForms";
import CardForm from "@/components/finance/CardForm";
import { CardDetail } from "@/components/finance/CardDetail";
import { AssetEditForm, AssetValuationForm } from "@/components/finance/AssetForms";

/**
 * Finance screens container. Owns all aggregate SWR reads (fired in
 * parallel) and money coercion at the boundary; `components/finance/*`
 * sections stay pure. The ledger manages its own keyset pagination below.
 */

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

  const queries = [budgets, accounts, subscriptions, debts, savings, prefs];
  const isLoading = queries.some((q) => q.isLoading);
  const failed = queries.filter((q) => q.error);

  const locale = prefs.data?.preferences.locale ?? "es-CO";
  const currency = prefs.data?.preferences.currency_code ?? "COP";

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
            <S5Sections categories={toCategoryOptions(categories.data ?? [])} accounts={toAccountOptions((accounts.data ?? []).map((row) => ({ id: row.id, name: row.name })))} debts={debts.data ?? []} savings={savings.data ?? []} cards={toAccountCards(accounts.data)} assets={assets.data ?? []} netWorth={netWorth.data ?? null} currency={currency} locale={locale} />
          </>
        )}
      </div>
    </div>
  );
}

/* S5 escritura: 6 SectionShell ocultables tras las F1 intactas + patrimonio-número. */
/* Títulos propios (sin hints de lectura) para no duplicar copy S1; subs monta solo crear. */
function S5Sections({ categories, accounts, debts, savings, cards, assets, netWorth, currency, locale }: { categories: { id: string; name: string }[]; accounts: { id: string; name: string }[]; debts: { id: string; name: string; creditor: string; original_amount: string | number; pending_amount: string | number; currency: string }[]; savings: { id: string; name: string; saved_amount: string | number; currency: string }[]; cards: { id: string; name: string; type: string; currency: string; balance: number; isCard: boolean; used: number | null; available: number | null; usagePct: number | null; alertLevel: string | null; statementBalance: number | null }[]; assets: { id: string; name: string }[]; netWorth: { per_currency: { currency: string; net_worth: string | number }[] } | null; currency: string; locale: string }) {
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
      </SectionShell>
      <SectionShell title={t("finance.manageSavings")} span="col-span-12 xl:col-span-6">
        <SavingsGoalForm categories={categories} onDone={noop} />
        {firstGoal ? (<div className="mt-4"><SavingsDepositForm goalId={firstGoal.id} saved={Number(firstGoal.saved_amount) || 0} currency={firstGoal.currency} onDone={noop} /></div>) : null}
      </SectionShell>
      <SectionShell title={t("finance.manageDebts")} span="col-span-12 xl:col-span-6">
        {firstDebt ? (<><DebtProgressBar original={Number(firstDebt.original_amount) || 0} pendingAmount={Number(firstDebt.pending_amount) || 0} /><div className="mt-4"><DebtPayForm debtId={firstDebt.id} pending={Number(firstDebt.pending_amount) || 0} currency={firstDebt.currency} onDone={noop} /></div><div className="mt-4"><DebtPaymentHistory debtId={firstDebt.id} onCorrect={noop} /></div><div className="mt-4"><DebtEditForm debtId={firstDebt.id} onDone={noop} /></div></>) : null}
      </SectionShell>
      <SectionShell title={t("finance.manageSubs")} span="col-span-12 xl:col-span-6">
        <SubscriptionCreateForm categories={categories} onDone={noop} />
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
