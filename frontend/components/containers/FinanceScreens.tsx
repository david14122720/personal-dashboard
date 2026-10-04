"use client";

import { useMemo, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import AppShell from "@/components/layout/AppShell";
import EmptyState from "@/components/ui/EmptyState";
import { t } from "@/lib/i18n";
import {
  CompactMoneyList,
  SectionShell,
} from "@/components/finance/FinanceSections";
import {
  useAccounts,
  usePreferences,
} from "@/lib/api/dashboard";
import {
  patchAccount,
  useAssets,
  useCategories,
  useSubscriptions,
  type MovementWire,
  type SubscriptionWire,
} from "@/lib/api/finance";
import {
  toAccountCards,
  toAccountOptions,
  toCategoryOptions,
  toSubscriptionRows,
  type AccountCardView,
} from "@/lib/finance/finance";
import { formatMoney } from "@/lib/api/money";
import { SubscriptionRow } from "@/components/finance/SubscriptionForms";
import {
  MovementModal,
  TransferModal,
  type MovementModalMode,
} from "@/components/finance/MovementForms";
import { MovementHistory } from "@/components/finance/MovementHistory";
import { CategoryChartSection } from "@/components/finance/CategoryCharts";
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

/** Client guard mirroring the server: `/^-?\d{1,9}(\.\d{1,2})?$/` and `|v| < 1e9`. */
export const BALANCE_INPUT_RE = /^-?\d{1,9}(\.\d{1,2})?$/;

export function isValidBalanceInput(raw: string): boolean {
  const trimmed = raw.trim();
  if (!BALANCE_INPUT_RE.test(trimmed)) return false;
  const value = Number(trimmed);
  return Number.isFinite(value) && Math.abs(value) < 1e9;
}

/**
 * Inline balance edit for one account row (design §6.2): the current value
 * stays visible, `Cancelar` sends nothing, success revalidates the
 * `finance/` SWR scope and the `dashboard/accounts` balance cache (the row
 * reads the latter, so skipping it would leave the old amount on screen).
 * Control is ≥44px with a focus ring and a per-account `aria-label`.
 */
export function AccountBalanceEdit({
  account,
  locale,
  onMoveMoney,
}: {
  account: AccountCardView;
  locale: string;
  /** Opens the transfer modal with this account preselected as origin. */
  onMoveMoney?: (account: AccountCardView, opener: HTMLButtonElement) => void;
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
      await mutate("dashboard/accounts");
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
          <p className="min-w-0 truncate text-sm">{account.name}</p>
          <p className="font-mono text-sm tabular-nums">{currentLabel}</p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={open}
            aria-label={t("finance.balanceEditLabel", { name: account.name })}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-hull px-3 py-2 text-xs transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            {t("finance.balanceEdit")}
          </button>
          {onMoveMoney ? (
            <button
              type="button"
              onClick={(event) => onMoveMoney(account, event.currentTarget)}
              aria-label={`${t("finance.addTransfer")}: ${account.name}`}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-hull px-3 py-2 text-xs transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            >
              {t("finance.addTransfer")}
            </button>
          ) : null}
        </div>
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
  const prefs = usePreferences();
  const allCategories = useCategories();
  const assets = useAssets();

  // S-C movements UI: account-click filter + add/edit modal state. The
  // subscription-pay wiring belongs to S-D and chart props to S-E.
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [movementModal, setMovementModal] = useState<MovementModalMode | null>(null);
  const [transferModal, setTransferModal] = useState<{ fromAccountId: string } | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const expenseBtnRef = useRef<HTMLButtonElement>(null);
  const incomeBtnRef = useRef<HTMLButtonElement>(null);

  function openMovementModal(mode: MovementModalMode): void {
    openerRef.current =
      mode.kind === "create" && mode.direction === "income"
        ? incomeBtnRef.current
        : expenseBtnRef.current;
    setMovementModal(mode);
  }

  function openTransferModal(account: AccountCardView, opener: HTMLButtonElement): void {
    openerRef.current = opener;
    setTransferModal({ fromAccountId: account.id });
  }

  const queries = [accounts, subscriptions, prefs];
  const isLoading = queries.some((q) => q.isLoading);
  const failed = queries.filter((q) => q.error);

  const locale = prefs.data?.preferences.locale ?? "es-CO";
  const currency = prefs.data?.preferences.currency_code ?? "COP";
  const cards = toAccountCards(accounts.data);

  // Single unfiltered category set (S-C kind-free, S-E chart/compare):
  // every owned category together for the movement modals and the chart.
  const movementCategoryOptions = useMemo(
    () => toCategoryOptions(allCategories.data ?? []),
    [allCategories.data],
  );
  const movementAccountOptions = useMemo(
    () =>
      toAccountOptions((accounts.data ?? []).map((row) => ({ id: row.id, name: row.name }))),
    [accounts.data],
  );
  // Transfers also need each account's currency for the client-side
  // same-currency check (the backend re-validates it regardless).
  const transferAccountOptions = useMemo(
    () =>
      (accounts.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        currency: row.currency,
      })),
    [accounts.data],
  );

  function openMovementEditor(movement: MovementWire): void {
    openerRef.current = document.activeElement as HTMLElement | null;
    setMovementModal({ kind: "edit", movement });
  }

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
              span="col-span-12 md:col-span-6 xl:col-span-6"
            >
              <div className="flex flex-col gap-2">
                {cards.length === 0 ? (
                  <EmptyState title={t("finance.noAccounts")} hint={t("finance.noAccountsHint")} />
                ) : null}
                {cards.map((card) => (
                  <AccountBalanceEdit
                    key={card.id}
                    account={card}
                    locale={locale}
                    onMoveMoney={openTransferModal}
                  />
                ))}
              </div>
            </SectionShell>
            <SectionShell
              title={t("finance.subscriptions")}
              hint={t("finance.subscriptionsHint")}
              span="col-span-12 md:col-span-6 xl:col-span-6"
            >
              <CompactMoneyList
                rows={toSubscriptionRows(subscriptions.data)}
                locale={locale}
                emptyTitle={t("finance.noSubscriptions")}
                emptyHint={t("finance.noSubscriptionsHint")}
              />
            </SectionShell>
            <SectionShell
              title={t("finance.movementsTitle")}
              hint={t("finance.movementsHint")}
              span="col-span-12"
            >
              <div className="flex flex-wrap gap-2">
                <button
                  ref={expenseBtnRef}
                  type="button"
                  onClick={() => openMovementModal({ kind: "create", direction: "expense" })}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-signal px-4 py-2 text-sm font-bold text-deck transition-colors hover:bg-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                >
                  {t("finance.addExpense")}
                </button>
                <button
                  ref={incomeBtnRef}
                  type="button"
                  onClick={() => openMovementModal({ kind: "create", direction: "income" })}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-hull px-4 py-2 text-sm transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                >
                  {t("finance.addIncome")}
                </button>
              </div>
              <div className="mt-4 border-t border-hull/60 pt-4">
                <MovementHistory
                  accounts={movementAccountOptions}
                  categories={movementCategoryOptions}
                  locale={locale}
                  currency={currency}
                  activeAccountId={activeAccountId}
                  onSelectAccount={setActiveAccountId}
                  onEdit={openMovementEditor}
                />
              </div>
            </SectionShell>
            <CategoryChartSection categories={movementCategoryOptions} locale={locale} currency={currency} />
            <S5Sections accounts={toAccountOptions((accounts.data ?? []).map((row) => ({ id: row.id, name: row.name })))} subs={subscriptions.data ?? []} assets={assets.data ?? []} />
            {movementModal ? (
              <MovementModal
                mode={movementModal}
                accounts={movementAccountOptions}
                categories={movementCategoryOptions}
                openerRef={openerRef}
                onClose={() => setMovementModal(null)}
              />
            ) : null}
            {transferModal ? (
              <TransferModal
                key={transferModal.fromAccountId}
                accounts={transferAccountOptions}
                initialFromAccountId={transferModal.fromAccountId}
                openerRef={openerRef}
                onClose={() => setTransferModal(null)}
              />
            ) : null}
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

/* S5 escritura: SubscriptionRow (Pay) + Assets shells tras las F1 intactas. */
/* The savings/debts write sections were deleted in S-F with their ledgers. */
function S5Sections({ accounts, subs, assets }: { accounts: { id: string; name: string }[]; subs: SubscriptionWire[]; assets: AssetWireWithDetails[] }) {
  const noop = (): void => undefined;
  const firstAsset = assets[0];
  return (
    <>
      <SectionShell title={t("finance.manageSubs")} span="col-span-12 xl:col-span-6">
        {/* Create/edit lives in Settings (SubscriptionsSection); Finance keeps the rows with Pay. */}
        {subs.map((sub) => (
          <div key={sub.id} className="mt-2">
            <SubscriptionRow sub={sub} />
          </div>
        ))}
      </SectionShell>
      <SectionShell title={t("finance.manageAssets")} span="col-span-12 xl:col-span-6">
        {firstAsset ? (<><AssetEditForm assetId={firstAsset.id} accounts={accounts} initial={toAssetEditInitial(firstAsset)} onDone={noop} /><div className="mt-4"><AssetValuationForm assetId={firstAsset.id} onDone={noop} /></div></>) : null}
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
