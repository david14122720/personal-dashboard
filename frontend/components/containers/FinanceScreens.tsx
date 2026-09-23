"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import AppShell from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import {
  AccountsList,
  CompactMoneyList,
  SavingsList,
  SectionShell,
} from "@/components/finance/FinanceSections";
import {
  useAccounts,
  useNetWorth,
  usePreferences,
} from "@/lib/api/dashboard";
import {
  patchAccount,
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
  toCategoryOptions,
  toDebtRows,
  toSavingsViews,
  toSubscriptionRows,
  type AccountCardView,
} from "@/lib/finance/finance";
import { formatMoney } from "@/lib/api/money";
import { SavingsDepositForm, SavingsGoalForm } from "@/components/finance/SavingsForms";
import { DebtEditForm, DebtPayForm, DebtPaymentHistory, DebtProgressBar } from "@/components/finance/DebtPayments";
import { SubscriptionCreateForm, SubscriptionRow } from "@/components/finance/SubscriptionForms";
import CardForm from "@/components/finance/CardForm";
import { CardDetail } from "@/components/finance/CardDetail";
import { AssetEditForm, AssetValuationForm } from "@/components/finance/AssetForms";

/**
 * Finance screens container. Owns all SWR reads (fired in parallel) and
 * money coercion at the boundary; `components/finance/*` sections stay
 * pure. Flow, ledger, capture and analysis blocks were removed in S3b:
 * every rendered block reads a surviving endpoint.
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

/** Client guard mirroring the server: `/^-?\d{1,6}(\.\d{1,2})?$/` and `|v| < 1e6`. */
export const BALANCE_INPUT_RE = /^-?\d{1,6}(\.\d{1,2})?$/;

export function isValidBalanceInput(raw: string): boolean {
  const trimmed = raw.trim();
  if (!BALANCE_INPUT_RE.test(trimmed)) return false;
  const value = Number(trimmed);
  return Number.isFinite(value) && Math.abs(value) < 1e6;
}

/**
 * Inline balance edit for one account card (design §6.2): the current value
 * stays visible, `Cancelar` sends nothing, success revalidates the
 * `finance/` SWR scope. Control is ≥44px with a focus ring and a
 * per-account `aria-label`.
 */
export function AccountBalanceEdit({
  account,
  locale,
}: {
  account: AccountCardView;
  locale: string;
}) {
  const { mutate } = useSWRConfig();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const currentLabel = formatMoney(account.balance, { locale, currency: account.currency });

  function open() {
    setDraft(String(account.balance));
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    if (!isValidBalanceInput(draft)) {
      setError(t("finance.balanceInvalid"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await patchAccount(account.id, { balance: draft.trim() });
      setEditing(false);
      await mutate((key) => typeof key === "string" && key.startsWith("finance/"));
    } catch {
      setError(t("finance.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-hull px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm">{account.name}</p>
          <p className="font-mono text-sm tabular-nums">{currentLabel}</p>
        </div>
        <button
          type="button"
          onClick={open}
          aria-label={t("finance.balanceEditLabel", { name: account.name })}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-hull px-3 py-2 text-xs transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
        >
          {t("finance.balanceEdit")}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-hull px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-sm">{account.name}</p>
        <p className="shrink-0 font-mono text-sm tabular-nums">{currentLabel}</p>
      </div>
      <label
        htmlFor={`balance-${account.id}`}
        className="mt-2 block text-xs text-instrument/60"
      >
        {t("finance.amountCop")}
      </label>
      <input
        id={`balance-${account.id}`}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={t("finance.balanceEditLabel", { name: account.name })}
        aria-invalid={error ? true : undefined}
        className="mt-1 min-h-[44px] w-full rounded-md border border-hull bg-deck px-3 py-2 font-mono text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
      />
      {error ? (
        <p role="alert" className="mt-1 text-xs text-alert">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-signal px-4 py-2 text-xs font-bold text-deck transition-colors hover:bg-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:opacity-50"
        >
          {saving ? t("finance.saving") : t("finance.save")}
        </button>
        <button
          type="button"
          onClick={cancel}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-hull px-4 py-2 text-xs transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
        >
          {t("finance.cancel")}
        </button>
      </div>
    </div>
  );
}

export default function FinanceScreens() {
  const { mutate } = useSWRConfig();

  const accounts = useAccounts();
  const subscriptions = useSubscriptions();
  const debts = useDebts();
  const savings = useSavingsGoals();
  const prefs = usePreferences();
  const categories = useFinanceCategories();
  const assets = useAssets();
  const netWorth = useNetWorth();

  const queries = [accounts, subscriptions, debts, savings, prefs];
  const isLoading = queries.some((q) => q.isLoading);
  const failed = queries.filter((q) => q.error);

  const locale = prefs.data?.preferences.locale ?? "es-CO";
  const currency = prefs.data?.preferences.currency_code ?? "COP";
  const cards = toAccountCards(accounts.data);

  return (
    <div>
      <h1 className="flex items-center gap-3 font-display text-2xl font-semibold tracking-wide">
        {t("finance.title")}
        <span className="rounded-full border border-signal/20 bg-signal/10 px-2.5 py-0.5 font-mono text-xs font-medium text-signal">
          {currency}
        </span>
      </h1>
      <p className="mt-1 text-sm text-instrument/60">
        {t("finance.subtitle", { currency })}
      </p>
      <div className="mt-6 grid grid-cols-12 gap-6">
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
              title={t("finance.accounts")}
              hint={t("finance.accountsHint")}
              span="col-span-12 xl:col-span-7"
            >
              <AccountsList accounts={cards} locale={locale} />
              <div className="mt-4 flex flex-col gap-2 border-t border-hull pt-4">
                {cards.map((card) => (
                  <AccountBalanceEdit key={card.id} account={card} locale={locale} />
                ))}
              </div>
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
            <S5Sections categories={toCategoryOptions(categories.data ?? [])} accounts={toAccountOptions((accounts.data ?? []).map((row) => ({ id: row.id, name: row.name })))} subs={subscriptions.data ?? []} debts={debts.data ?? []} savings={savings.data ?? []} cards={cards} assets={assets.data ?? []} netWorth={netWorth.data ?? null} currency={currency} locale={locale} />
          </>
        )}
      </div>
    </div>
  );
}

/** JD-ASSET: ensanche local — AssetWire ya trae la categoría almacenada. */
export type AssetWireWithDetails = {
  id: string;
  name: string;
  category?: string | null;
  account_id?: string | null;
  acquired_on?: string | null;
  notes?: string | null;
};

/** Mapeo AssetWire → initial de AssetEditForm (renombrar preserva categoría). */
export function toAssetEditInitial(a: AssetWireWithDetails): {
  name?: string | null;
  category?: string | null;
  account_id?: string | null;
  acquired_on?: string | null;
  notes?: string | null;
} {
  return {
    name: a.name ?? null,
    category: a.category ?? null,
    account_id: a.account_id ?? null,
    acquired_on: a.acquired_on ?? null,
    notes: a.notes ?? null,
  };
}

/* S5 escritura: 6 SectionShell ocultables tras las F1 intactas + patrimonio-número. */
/* Títulos propios (sin hints de lectura) para no duplicar copy S1. PR-3 FIX: filas */
/* SubscriptionRow + edición/borrado SavingsGoalForm cableados a listas. */
function S5Sections({ categories, accounts, subs, debts, savings, cards, assets, netWorth, currency, locale }: { categories: { id: string; name: string }[]; accounts: { id: string; name: string }[]; subs: SubscriptionWire[]; debts: { id: string; name: string; creditor: string; original_amount: string | number; pending_amount: string | number; currency: string }[]; savings: SavingsGoalWire[]; cards: { id: string; name: string; type: string; currency: string; balance: number; isCard: boolean; used: number | null; available: number | null; usagePct: number | null; alertLevel: string | null; statementBalance: number | null }[]; assets: AssetWireWithDetails[]; netWorth: { per_currency: { currency: string; net_worth: string | number }[] } | null; currency: string; locale: string }) {
  const noop = (): void => undefined;
  const firstDebt = debts[0];
  const firstGoal = savings[0];
  const firstCard = cards.find((c) => c.isCard);
  const firstAsset = assets[0];
  const worth = netWorth?.per_currency.find((e) => e.currency === currency) ?? netWorth?.per_currency[0];
  return (
    <>
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
        {firstAsset ? (<><AssetEditForm assetId={firstAsset.id} accounts={accounts} initial={toAssetEditInitial(firstAsset)} onDone={noop} /><div className="mt-4"><AssetValuationForm assetId={firstAsset.id} onDone={noop} /></div></>) : null}
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
