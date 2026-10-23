"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSWRConfig } from "swr";
import AppShell from "@/components/layout/AppShell";
import DeckCard, { DeckEmptyState } from "@/components/dashboard/DeckCard";
import FinanceKpis from "@/components/finance/FinanceKpis";
import {
  CalendarActionIcon,
  SubscriptionsIcon,
} from "@/components/dashboard/icons";
import {
  AddCircleIcon,
  ArrowRightIcon,
  PaymentsIcon,
  PlusIcon,
  RefreshIcon,
  TransferActionIcon,
  TuneIcon,
  WalletIcon,
} from "@/components/finance/FinanceIcons";
import { deck } from "@/components/ui/deckStyles";
import { t } from "@/lib/i18n";
import { useAccounts, usePreferences } from "@/lib/api/dashboard";
import {
  patchAccount,
  useAssets,
  useCategories,
  useMovementsSummary,
  useSubscriptions,
  type MovementWire,
} from "@/lib/api/finance";
import {
  currentPeriodRange,
  isPaidThisCycle,
  toAccountCards,
  toAccountOptions,
  toCategoryOptions,
  toSummaryExpenseSlices,
  toSummaryExpenseTotal,
  toTotalBalance,
  todayInBogota,
  type AccountCardView,
} from "@/lib/finance/finance";
import { formatMoney } from "@/lib/api/money";
import { toMonthlyCost } from "@/lib/dashboard/transforms";
import { SubscriptionRow } from "@/components/finance/SubscriptionForms";
import {
  MovementModal,
  TransferModal,
  type MovementModalMode,
} from "@/components/finance/MovementForms";
import { MovementHistory } from "@/components/finance/MovementHistory";
import { CategoryChartSection } from "@/components/finance/CategoryCharts";
import { AccountChartSection } from "@/components/finance/AccountCharts";
import { AssetEditForm, AssetValuationForm } from "@/components/finance/AssetForms";

/**
 * Finance screens container. Owns all SWR reads (fired in parallel) and
 * money coercion at the boundary; `components/finance/*` sections stay
 * pure. Flow, ledger, capture and analysis blocks were removed in S3b:
 * every rendered block reads a surviving endpoint.
 *
 * T4 layout (canonical `finanzas-desktop.html` + `finanzas-mobile.html`):
 * header (title, currency chip, sync pill, real-action toolbar) → four KPI
 * tiles → `lg:grid-cols-12` with the accounts/movements/assets column (7) and
 * the subscriptions/chart/quick-links column (5). Below `md` the header and
 * the KPI grid hand their children back to the page flex container, so the
 * phone order is title → balance tile → quick bar → cards, with no duplicated
 * control and one accessible name per operation.
 */

// Canonical strings from the UI-polish contract (`design.md`, "Canonical visual
// contract"): one role, one look for fields, primary and ghost buttons. Every
// control in this file uses them verbatim.
const fieldClass =
  "min-h-11 w-full rounded-md border border-hair bg-deck px-3 text-sm text-instrument transition-colors placeholder:text-slate-500 focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/30";
const primaryBtn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-signal px-4 font-display text-sm font-semibold text-deck transition-colors hover:bg-signal-soft disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-hair px-3 font-display text-sm text-instrument-dim transition-colors hover:border-signal hover:text-signal";

function AggregatesSkeleton() {
  return (
    <div role="status" aria-label={t("finance.loadingSections")} aria-busy="true" className="grid grid-cols-12 gap-4">
      {[0, 1, 2].map((n) => (
        <div
          key={n}
          className="col-span-12 animate-pulse rounded-xl border border-hair bg-card p-5 md:col-span-6"
        >
          <div className="h-4 w-24 rounded bg-hair" />
          <div className="mt-3 h-8 w-32 rounded bg-hair" />
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

/** Initials avatar of an account tile. The wire has no type or brand, so the
 * tile never invents one: the letters come from the real account name. */
export function accountInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

/**
 * One account tile of the Cuentas card (`finanzas-desktop.html` matrix cell):
 * initials avatar, real name, real balance, real currency caption and the two
 * existing per-account actions. Inline balance edit (design §6.2): the current
 * value stays visible, `Cancelar` sends nothing, success revalidates the
 * `finance/` SWR scope and the `dashboard/accounts` balance cache (the tile
 * reads the latter, so skipping it would leave the old amount on screen).
 * Control is ≥44px with a focus ring and a per-account `aria-label`.
 *
 * `openEditorToken` lets the header's `Conciliar saldo` action open exactly one
 * real editor (the first account) without inventing a second write path.
 */
export function AccountBalanceEdit({
  account,
  locale,
  onMoveMoney,
  openEditorToken,
}: {
  account: AccountCardView;
  locale: string;
  /** Opens the transfer modal with this account preselected as origin. */
  onMoveMoney?: (account: AccountCardView, opener: HTMLButtonElement) => void;
  /** Increments when the header asks this tile to start reconciling. */
  openEditorToken?: number;
}) {
  const { mutate } = useSWRConfig();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const handledToken = useRef(0);
  const currentLabel = formatMoney(account.balance, { locale, currency: account.currency });

  function open() {
    setDraft(String(account.balance));
    setError(null);
    setEditing(true);
  }

  // The header action targets one tile; the ref makes the token fire once.
  useEffect(() => {
    if (!openEditorToken || openEditorToken === handledToken.current) return;
    handledToken.current = openEditorToken;
    setDraft(String(account.balance));
    setError(null);
    setEditing(true);
  }, [openEditorToken, account.balance]);

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
      // The balance lives under `dashboard/accounts`; only revalidating
      // `finance/` would leave the tile stale. Refresh that key first and keep
      // the broader finance scope best-effort: a failing aggregate read (e.g.
      // the summary endpoint) must never turn a successful save into the
      // «no se pudo guardar» state.
      await mutate("dashboard/accounts");
      void mutate((key) => typeof key === "string" && key.startsWith("finance/")).catch(() => {});
    } catch {
      setError(t("finance.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className={deck.accountTile}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className={deck.accountAvatar}>
            {accountInitials(account.name)}
          </span>
          <span className="truncate text-sm font-medium text-instrument">{account.name}</span>
        </div>
        <div className="min-w-0">
          <span className="block truncate font-mono text-base font-bold tracking-tight text-instrument sm:text-lg">
            {currentLabel}
          </span>
          <span className={`${deck.accountCaption} mt-0.5 block truncate`}>
            {account.currency}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1 border-t border-hair pt-2">
          {onMoveMoney ? (
            <button
              type="button"
              onClick={(event) => onMoveMoney(account, event.currentTarget)}
              aria-label={`${t("finance.addTransfer")}: ${account.name}`}
              className={deck.tileActionSignal}
            >
              {t("finance.tileMove")}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={open}
            aria-label={t("finance.balanceEditLabel", { name: account.name })}
            className={deck.tileActionNeutral}
          >
            {t("finance.tileEdit")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={deck.accountTile}>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm text-instrument">{account.name}</p>
        <p className="shrink-0 font-mono text-xs tabular-nums text-muted">{currentLabel}</p>
      </div>
      <label
        htmlFor={`balance-${account.id}`}
        className="block text-[11px] uppercase tracking-wider text-faint"
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
        className={`${fieldClass} font-mono tabular-nums`}
      />
      {error ? (
        <p role="alert" className="text-xs text-alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className={primaryBtn}
        >
          {saving ? t("finance.saving") : t("finance.save")}
        </button>
        <button type="button" onClick={cancel} className={ghostBtn}>
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
  // Cycle KPI only: the server summary already applies the single-currency
  // rule and keeps transfers out of the sums (S1). The ledger itself stays in
  // `MovementHistory` with its current unfiltered `/movements` contract.
  const cycleRange = currentPeriodRange("month");
  const cycleSummary = useMovementsSummary({ ...cycleRange, group: "month" });

  // S-C movements UI: account-click filter + add/edit modal state. The
  // subscription-pay wiring belongs to S-D and chart props to S-E.
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [movementModal, setMovementModal] = useState<MovementModalMode | null>(null);
  const [transferModal, setTransferModal] = useState<{ fromAccountId: string } | null>(null);
  const [reconcileToken, setReconcileToken] = useState(0);
  const openerRef = useRef<HTMLElement | null>(null);

  /** Remembers the control that opened a dialog so focus returns to it. */
  function openMovementModal(mode: MovementModalMode, opener: HTMLElement | null): void {
    openerRef.current = opener;
    setMovementModal(mode);
  }

  function openTransferModal(account: AccountCardView, opener: HTMLButtonElement): void {
    openerRef.current = opener;
    setTransferModal({ fromAccountId: account.id });
  }

  /** Toolbar `Mover dinero`: same modal, no preselected origin. */
  function openTransferFromToolbar(opener: HTMLButtonElement): void {
    openerRef.current = opener;
    setTransferModal({ fromAccountId: "" });
  }

  /** Toolbar `Conciliar saldo`: scroll to Cuentas and start its first editor. */
  function openReconcile(): void {
    document.getElementById("finance-accounts")?.scrollIntoView?.({ block: "nearest" });
    setReconcileToken((token) => token + 1);
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
  // Shared, UNFILTERED account options: the movement history filter, the asset
  // account labels and the asset form all read this list, so nothing here may
  // depend on which modal is open.
  const movementAccountOptions = useMemo(
    () =>
      toAccountOptions((accounts.data ?? []).map((row) => ({ id: row.id, name: row.name }))),
    [accounts.data],
  );
  // The edit modal only offers same-currency accounts: a stored movement's
  // amount lives in the currency of the account holding it, and the server
  // rejects a cross-currency re-point with 422, so the UI must not offer a
  // choice that can only fail. When the movement's account is archived it is
  // absent from the brief list, the currency is unknown, and the modal keeps
  // every account (the server still rejects the mismatch).
  const movementModalAccountOptions = useMemo(() => {
    if (movementModal?.kind !== "edit") return movementAccountOptions;
    const stored = (accounts.data ?? []).find((a) => a.id === movementModal.movement.account_id);
    if (!stored) return movementAccountOptions;
    return toAccountOptions(
      (accounts.data ?? [])
        .filter((row) => row.currency === stored.currency)
        .map((row) => ({ id: row.id, name: row.name })),
    );
  }, [accounts.data, movementAccountOptions, movementModal]);
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

  const fmt = (value: string | number | null | undefined) =>
    formatMoney(value, { locale, currency });

  // -- KPI data: real reads only (D10). ------------------------------------
  const totalBalance = toTotalBalance(cards, currency);
  const excludedAccounts = cards.filter((account) => account.currency !== currency).length;
  const balanceFooter =
    cards.length === 0
      ? t("finance.kpiBalanceEmpty")
      : excludedAccounts > 0
        ? `${t("dashboard.kpiBalanceFooter", { currency })} · ${t("dashboard.kpiBalanceExcluded", {
            n: excludedAccounts,
          })}`
        : t("dashboard.kpiBalanceFooter", { currency });
  const accountsFooter =
    cards.length === 0
      ? t("dashboard.kpiAccountsEmpty")
      : t("finance.kpiAccountsInCurrency", {
          n: cards.length - excludedAccounts,
          total: cards.length,
          currency,
        });

  // The charts default to the natural month, so the spend tile reads the same
  // window from the server summary; the chips are the real top-2.
  const cycleSpend = toSummaryExpenseTotal(cycleSummary.data);
  // Truncated to two chips plus an honest `+N más` marker: the KPI keeps summing
  // every category, so folding one silently would leave the breakdown
  // unreconcilable with the figure above it (same rule as the Resumen tile).
  const cycleSlices = toSummaryExpenseSlices(cycleSummary.data, allCategories.data);
  const cycleChips = cycleSlices
    .slice(0, 2)
    .map((slice) => t("dashboard.kpiCycleChip", { name: slice.name, amount: fmt(slice.value) }));
  const hiddenCycleChips = Math.max(0, cycleSlices.length - cycleChips.length);
  const cycleTone: "ok" | "empty" | "loading" | "error" = cycleSummary.error
    ? "error"
    : cycleSummary.isLoading
      ? "loading"
      : cycleSpend === 0
        ? "empty"
        : "ok";
  const cycleFooter =
    cycleTone === "error"
      ? t("dashboard.kpiCycleSpendUnavailable")
      : cycleTone === "loading"
        ? t("common.loading")
        : cycleTone === "empty"
          ? t("dashboard.kpiCycleSpendEmpty")
          : cycleChips.length > 0
            ? hiddenCycleChips > 0
              ? `${cycleChips.join(" + ")} ${t("dashboard.kpiCycleMore", { n: hiddenCycleChips })}`
              : cycleChips.join(" + ")
            : t("dashboard.kpiCycleSpendUncategorized");

  // Monthly-equivalent total over same-currency subscriptions only (foreign
  // ones are excluded and stated, never converted — same rule as the balance).
  const subsInCurrency = (subscriptions.data ?? []).filter((sub) => sub.currency === currency);
  const excludedSubs = (subscriptions.data ?? []).length - subsInCurrency.length;
  const monthlyCost = toMonthlyCost(subsInCurrency);
  const today = todayInBogota();
  const pendingCharges = (subscriptions.data ?? []).filter(
    (sub) =>
      sub.is_active === true &&
      sub.next_billing_on !== null &&
      sub.next_billing_on !== undefined &&
      !isPaidThisCycle(
        { last_paid_on: sub.last_paid_on ?? null, next_billing_on: sub.next_billing_on },
        today,
      ),
  ).length;
  const subsTone: "ok" | "empty" | "loading" | "error" = subscriptions.error
    ? "error"
    : subscriptions.isLoading
      ? "loading"
      : pendingCharges === 0
        ? "ok"
        : "empty";
  const subsPendingCopy =
    subsTone === "error"
      ? t("dashboard.sectionLoadFailed")
      : subsTone === "loading"
        ? t("common.loading")
        : pendingCharges === 0
          ? t("dashboard.kpiSubsNone")
          : pendingCharges === 1
            ? t("dashboard.kpiSubsPendingOne")
            : t("dashboard.kpiSubsPending", { n: pendingCharges });
  const subsFooter =
    excludedSubs > 0
      ? `${subsPendingCopy} · ${t("dashboard.kpiBalanceExcluded", { n: excludedSubs })}`
      : subsPendingCopy;

  /** Revalidate every read the page owns (retry + «Actualizar saldos»). */
  const revalidateAll = () =>
    void mutate(
      (key) =>
        typeof key === "string" && (key.startsWith("finance/") || key.startsWith("dashboard/")),
    );

  const subsData = subscriptions.data ?? [];
  const assetsData = assets.data ?? [];
  const firstAsset = assetsData[0];
  const assetNameById = new Map(movementAccountOptions.map((option) => [option.id, option.name]));

  return (
    <div className="flex flex-col gap-gutter-desktop">
      {/* 1. Header: title, real currency chip, honest status pill and the
          prototype's toolbar mapped onto existing operations only. Below `md`
          the wrapper hands both blocks back to the page flex container so the
          phone order is title → KPI row → quick bar. */}
      <div className="max-md:contents md:flex md:flex-col md:gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-4">
        <div className="max-md:order-1 flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <h1 className={deck.pageTitle}>{t("finance.title")}</h1>
            <span className={deck.currencyChip}>{currency}</span>
            <span className="max-md:ml-auto">
            </span>
          </div>
          <p className="text-sm text-muted">{t("finance.subtitle", { currency })}</p>
        </div>
        <div className="max-md:order-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:flex-wrap lg:items-center lg:justify-end lg:gap-2.5">
          <button
            type="button"
            onClick={(event) => openTransferFromToolbar(event.currentTarget)}
            className={deck.toolbarActionNeutral}
          >
            <TransferActionIcon className="h-4 w-4 text-sky-400" />
            {t("finance.addTransfer")}
          </button>
          <button
            type="button"
            onClick={openReconcile}
            disabled={cards.length === 0}
            className={`${deck.toolbarActionNeutral} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <TuneIcon className="h-4 w-4 text-faint" />
            {t("finance.reconcileBalance")}
          </button>
          <button
            type="button"
            onClick={(event) =>
              openMovementModal({ kind: "create", direction: "income" }, event.currentTarget)
            }
            className={deck.toolbarActionFlow}
          >
            <AddCircleIcon className="h-4 w-4" />
            {t("finance.addIncomeCta")}
          </button>
          <button
            type="button"
            onClick={(event) =>
              openMovementModal({ kind: "create", direction: "expense" }, event.currentTarget)
            }
            className={deck.toolbarActionSignal}
          >
            <PaymentsIcon className="h-4 w-4" />
            {t("finance.addExpenseCta")}
          </button>
        </div>
      </div>

      {isLoading ? (
        <AggregatesSkeleton />
      ) : failed.length > 0 ? (
        <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-4 sm:p-5">
          <h2 className="font-display text-base font-medium tracking-wide">{t("finance.loadFailed")}</h2>
          <p className="mt-1 text-sm text-muted">
            {t("finance.loadFailedDetail", { failed: failed.length, total: queries.length })}
          </p>
          <button type="button" onClick={revalidateAll} className={`mt-4 ${ghostBtn}`}>
            {t("common.retry")}
          </button>
        </div>
      ) : (
        <>
          {/* 2. KPI row (prototype "KPIs / Telemetry Top Bar"). */}
          <FinanceKpis
            currency={currency}
            balance={{ display: fmt(totalBalance), footer: balanceFooter, tone: "ok" }}
            accounts={{
              count: String(cards.length),
              unit: t("finance.kpiAccountsUnit"),
              footer: accountsFooter,
            }}
            spend={{
              display: cycleTone === "error" || cycleTone === "loading" ? "—" : fmt(cycleSpend),
              footer: cycleFooter,
              tone: cycleTone,
            }}
            subscriptions={{
              display: subsTone === "error" || subsTone === "loading" ? "—" : fmt(monthlyCost),
              footer: subsFooter,
              tone: subsTone,
            }}
          />

          {/* 3. Main grid: left column (accounts, movements, assets) and right
              column (subscriptions, chart, quick links). Below `lg` both
              wrappers become `display: contents`, so the `order-*` classes
              drive the phone sequence of the mobile prototype. */}
          <div className="max-md:order-4 grid grid-cols-1 gap-gutter-desktop lg:grid-cols-12 lg:items-start">
            <div className="max-lg:contents lg:col-span-7 lg:flex lg:flex-col lg:gap-gutter-desktop">
              <div id="finance-accounts" className="max-lg:order-1">
                <DeckCard
                  title={t("finance.accounts")}
                  hint={t("finance.accountsHint")}
                  headerClassName={deck.sectionHeaderWrap}
                  meta={
                    cards.length > 0 ? (
                      <span className={deck.countPill}>
                        {cards.length} {t("finance.kpiAccountsUnit")}
                      </span>
                    ) : null
                  }
                  action={
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={revalidateAll}
                        aria-label={t("finance.refreshBalances")}
                        title={t("finance.refreshBalances")}
                        className={deck.headerIconButton}
                      >
                        <RefreshIcon className="h-4 w-4" />
                      </button>
                      <Link href="/dashboard/ajustes/" className={deck.ghostButton}>
                        <PlusIcon className="h-3.5 w-3.5" />
                        {t("finance.newAccount")}
                      </Link>
                    </div>
                  }
                >
                  {cards.length === 0 ? (
                    <DeckEmptyState
                      icon={<WalletIcon className="h-5 w-5 text-sky-400/70" />}
                      title={t("finance.noAccounts")}
                      hint={t("finance.noAccountsHint")}
                    />
                  ) : (
                    <ul className="grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-3">
                      {cards.map((card, index) => (
                        <li key={card.id} className="min-w-0">
                          <AccountBalanceEdit
                            account={card}
                            locale={locale}
                            onMoveMoney={openTransferModal}
                            openEditorToken={index === 0 ? reconcileToken : undefined}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </DeckCard>
              </div>

              <div className="max-lg:order-3">
                <DeckCard
                  title={t("finance.movementsTitle")}
                  hint={t("finance.movementsRecentHint")}
                  headerClassName={deck.sectionHeaderWrap}
                  action={
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={(event) =>
                          openMovementModal(
                            { kind: "create", direction: "expense" },
                            event.currentTarget,
                          )
                        }
                        className={primaryBtn}
                      >
                        {t("finance.addExpense")}
                      </button>
                      <button
                        type="button"
                        onClick={(event) =>
                          openMovementModal(
                            { kind: "create", direction: "income" },
                            event.currentTarget,
                          )
                        }
                        className={ghostBtn}
                      >
                        {t("finance.addIncome")}
                      </button>
                    </div>
                  }
                >
                  <MovementHistory
                    accounts={movementAccountOptions}
                    categories={movementCategoryOptions}
                    locale={locale}
                    currency={currency}
                    activeAccountId={activeAccountId}
                    onSelectAccount={setActiveAccountId}
                    onEdit={openMovementEditor}
                  />
                </DeckCard>
              </div>

              {/* Real assets aggregate (the prototype's second media slot).
                  The net-worth figure and the liquidity/persistence telemetry
                  are omitted: no series exists here and the prototype's claims
                  are invented (D10). */}
              <div className="max-lg:order-4">
                <DeckCard
                  title={t("finance.manageAssets")}
                  hint={t("finance.assetsHint")}
                  headerClassName={deck.sectionHeaderWrap}
                  meta={
                    assetsData.length > 0 ? (
                      <span className={deck.countPill}>
                        {t("finance.assetsCount", { n: assetsData.length })}
                      </span>
                    ) : null
                  }
                >
                  {firstAsset ? (
                    <>
                      <ul className="flex flex-col gap-2">
                        {assetsData.slice(0, 4).map((asset) => (
                          <li key={asset.id} className={deck.listRow}>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-instrument">
                                {asset.name}
                              </p>
                              <p className="truncate text-xs text-muted">
                                {asset.category}
                                {asset.account_id
                                  ? ` · ${assetNameById.get(asset.account_id) ?? asset.currency}`
                                  : ` · ${asset.currency}`}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-4 border-t border-hair pt-4">
                        <AssetEditForm
                          assetId={firstAsset.id}
                          accounts={movementAccountOptions}
                          initial={toAssetEditInitial(firstAsset)}
                          onDone={() => undefined}
                        />
                        <div className="mt-4">
                          <AssetValuationForm assetId={firstAsset.id} onDone={() => undefined} />
                        </div>
                      </div>
                    </>
                  ) : (
                    <DeckEmptyState
                      icon={<WalletIcon className="h-5 w-5 text-sky-400/70" />}
                      title={t("progress.emptyWorth")}
                      hint={t("progress.emptyWorthHint")}
                    />
                  )}
                </DeckCard>
              </div>
            </div>

            <div className="max-lg:contents lg:col-span-5 lg:flex lg:flex-col lg:gap-gutter-desktop">
              <div className="max-lg:order-2">
                <CategoryChartSection
                  categories={movementCategoryOptions}
                  locale={locale}
                  currency={currency}
                />
              </div>

              {/* Mobile (<lg): both wrappers share order-2, so the DOM tie
                  breakers keep categories -> account -> movements(3). At lg
                  the right column stack already puts this card right below
                  the categories block. */}
              <div className="max-lg:order-2" data-finance-account-chart>
                <AccountChartSection locale={locale} currency={currency} />
              </div>

              <div className="max-lg:order-5">
                <DeckCard
                  title={t("finance.manageSubs")}
                  hint={t("finance.subscriptionsHint")}
                  headerClassName={deck.sectionHeaderWrap}
                  meta={
                    subsData.length > 0 ? (
                      <span className={deck.countPill}>
                        {t("dashboard.recordsMeta", { n: subsData.length })}
                      </span>
                    ) : null
                  }
                >
                  {subsData.length === 0 ? (
                    <>
                      <DeckEmptyState
                        icon={<CalendarActionIcon className="h-5 w-5 text-sky-400/70" />}
                        title={t("finance.noSubscriptions")}
                        hint={t("finance.noSubscriptionsHint")}
                      />
                      <div className="mt-3 flex justify-center">
                        <Link href="/dashboard/ajustes/" className={deck.cardFooterLink}>
                          <PlusIcon className="h-4 w-4" />
                          {t("finance.newSubscriptionCta")}
                        </Link>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {subsData.map((sub) => (
                        <SubscriptionRow key={sub.id} sub={sub} />
                      ))}
                    </div>
                  )}
                  {subsData.length > 0 ? (
                    <div className={deck.cardFooterRow}>
                      <Link href="/dashboard/ajustes/" className={deck.cardFooterLink}>
                        <PlusIcon className="h-4 w-4" />
                        {t("finance.manageInSettings")}
                      </Link>
                    </div>
                  ) : null}
                </DeckCard>
              </div>

              {/* Quick links to real routes: Ajustes owns the create/edit
                  paths, Progreso owns the read-only patrimonio view. */}
              <nav
                aria-label={t("finance.quickActionsLabel")}
                className="max-lg:order-6 grid grid-cols-1 gap-3 sm:grid-cols-2"
              >
                <Link href="/dashboard/ajustes/" className={deck.quickCard}>
                  <span className="flex items-center justify-between">
                    <span className={deck.quickCardIcon}>
                      <SubscriptionsIcon className="h-4 w-4" />
                    </span>
                    <ArrowRightIcon className="h-4 w-4 text-faint transition-transform group-hover:translate-x-1 group-hover:text-sky-400" />
                  </span>
                  <span className="min-w-0">
                    <span className={deck.quickCardTitle}>{t("finance.subscriptions")}</span>
                    <span className={deck.quickCardCopy}>{t("finance.subscriptionSettingsHint")}</span>
                  </span>
                </Link>
                <Link href="/dashboard/progreso/" className={deck.quickCard}>
                  <span className="flex items-center justify-between">
                    <span className={deck.quickCardIcon}>
                      <WalletIcon className="h-4 w-4" />
                    </span>
                    <ArrowRightIcon className="h-4 w-4 text-faint transition-transform group-hover:translate-x-1 group-hover:text-emerald-400" />
                  </span>
                  <span className="min-w-0">
                    <span className={deck.quickCardTitle}>{t("progress.title")}</span>
                    <span className={deck.quickCardCopy}>{t("progress.subtitle")}</span>
                  </span>
                </Link>
              </nav>
            </div>
          </div>
        </>
      )}

      {movementModal ? (
        <MovementModal
          mode={movementModal}
          accounts={movementModalAccountOptions}
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

export function FinanceScreensShell() {
  return (
    <AppShell>
      <FinanceScreens />
    </AppShell>
  );
}
