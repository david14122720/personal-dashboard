"use client";

import { useSWRConfig } from "swr";
import AppShell from "@/components/layout/AppShell";
import TransactionsLedger from "@/components/finance/TransactionsLedger";
import {
  AccountsList,
  BudgetsList,
  CompactMoneyList,
  SavingsList,
  SectionShell,
} from "@/components/finance/FinanceSections";
import { useAccounts, useBudgets, usePreferences } from "@/lib/api/dashboard";
import { useDebts, useSavingsGoals, useSubscriptions } from "@/lib/api/finance";
import {
  toAccountCards,
  toBudgetViews,
  toDebtRows,
  toSavingsViews,
  toSubscriptionRows,
} from "@/lib/finance/finance";

/**
 * Finance screens container. Owns all aggregate SWR reads (fired in
 * parallel) and money coercion at the boundary; `components/finance/*`
 * sections stay pure. The ledger manages its own keyset pagination below.
 */

function AggregatesSkeleton() {
  return (
    <div role="status" aria-label="Loading finance sections" aria-busy="true" className="grid grid-cols-12 gap-4">
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

  const queries = [budgets, accounts, subscriptions, debts, savings, prefs];
  const isLoading = queries.some((q) => q.isLoading);
  const failed = queries.filter((q) => q.error);

  const locale = prefs.data?.preferences.locale ?? "es-CO";
  const currency = prefs.data?.preferences.currency_code ?? "COP";

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-wide">Finance</h1>
      <p className="mt-1 text-sm text-instrument/60">
        Ledger, budgets, accounts, and recurring money in {currency}.
      </p>
      <div className="mt-6 grid grid-cols-12 gap-4">
        <div className="col-span-12">
          <TransactionsLedger locale={locale} />
        </div>
        {isLoading ? (
          <div className="col-span-12">
            <AggregatesSkeleton />
          </div>
        ) : failed.length > 0 ? (
          <div className="col-span-12">
            <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-5">
              <h2 className="font-display text-lg font-semibold">Finance sections failed to load</h2>
              <p className="mt-1 text-sm text-instrument/70">
                {failed.length} of {queries.length} sections failed. Check your connection and retry.
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
                Retry
              </button>
            </div>
          </div>
        ) : (
          <>
            <SectionShell
              title="Budgets"
              hint="Spend against each active budget."
              span="col-span-12 xl:col-span-7"
            >
              <BudgetsList budgets={toBudgetViews(budgets.data)} locale={locale} />
            </SectionShell>
            <SectionShell
              title="Accounts"
              hint="Balances and credit-card usage."
              span="col-span-12 xl:col-span-5"
            >
              <AccountsList accounts={toAccountCards(accounts.data)} locale={locale} />
            </SectionShell>
            <SectionShell
              title="Subscriptions"
              hint="Active recurring charges."
              span="col-span-12 md:col-span-6 xl:col-span-4"
            >
              <CompactMoneyList
                rows={toSubscriptionRows(subscriptions.data)}
                locale={locale}
                emptyTitle="No active subscriptions"
                emptyHint="Recurring charges will appear here."
              />
            </SectionShell>
            <SectionShell
              title="Debts"
              hint="Remaining balances."
              span="col-span-12 md:col-span-6 xl:col-span-4"
            >
              <CompactMoneyList
                rows={toDebtRows(debts.data)}
                locale={locale}
                emptyTitle="No debts"
                emptyHint="Owed balances will appear here."
              />
            </SectionShell>
            <SectionShell
              title="Savings"
              hint="Goal progress."
              span="col-span-12 xl:col-span-4"
            >
              <SavingsList goals={toSavingsViews(savings.data)} locale={locale} />
            </SectionShell>
          </>
        )}
      </div>
    </div>
  );
}

export function FinanceScreensShell() {
  return (
    <AppShell>
      <FinanceScreens />
    </AppShell>
  );
}
