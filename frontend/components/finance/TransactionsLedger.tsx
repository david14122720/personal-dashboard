"use client";

import { useState } from "react";
import EmptyState from "@/components/ui/EmptyState";
import {
  fetchTransactionsPage,
  useFinanceCategories,
  useTransactionsPage,
  type TransactionFilters,
  type TransactionWire,
} from "@/lib/api/finance";
import { useAccounts } from "@/lib/api/dashboard";
import { formatMoney } from "@/lib/api/money";
import { t } from "@/lib/i18n";
import {
  ledgerKey,
  toAccountOptions,
  toCategoryOptions,
  toLedgerRows,
  type LedgerRow,
} from "@/lib/finance/finance";

/**
 * Transactions ledger: filterable table with keyset cursor pagination.
 * The first page loads via SWR; "Load more" appends subsequent pages in an
 * event handler using the opaque `next_cursor` verbatim (never decoded).
 * Remounting on `ledgerKey` resets pagination whenever filters change.
 */

export interface LedgerDraft {
  account_id: string;
  category_id: string;
  type: string;
  from: string;
  to: string;
}

export const EMPTY_DRAFT: LedgerDraft = {
  account_id: "",
  category_id: "",
  type: "",
  from: "",
  to: "",
};

function toAppliedFilters(draft: LedgerDraft): TransactionFilters {
  return {
    ...(draft.account_id ? { account_id: draft.account_id } : {}),
    ...(draft.category_id ? { category_id: draft.category_id } : {}),
    ...(draft.type === "income" || draft.type === "expense" ? { type: draft.type } : {}),
    ...(draft.from ? { from: draft.from } : {}),
    ...(draft.to ? { to: draft.to } : {}),
    limit: 50,
  };
}

const inputClass =
  "w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument placeholder:text-instrument/40 focus:border-signal focus:outline-none";

function LedgerFilters({
  draft,
  onChange,
  onApply,
  onClear,
  accounts,
  categories,
  accountsLoading,
  categoriesLoading,
}: {
  draft: LedgerDraft;
  onChange: (next: LedgerDraft) => void;
  onApply: () => void;
  onClear: () => void;
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  accountsLoading: boolean;
  categoriesLoading: boolean;
}) {
  return (
    <form
      aria-label={t("finance.ledgerFilters")}
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.from")}
        <input
          type="date"
          aria-label={t("finance.from")}
          className={inputClass}
          value={draft.from}
          onChange={(event) => onChange({ ...draft, from: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.to")}
        <input
          type="date"
          aria-label={t("finance.to")}
          className={inputClass}
          value={draft.to}
          onChange={(event) => onChange({ ...draft, to: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.txType")}
        <select
          aria-label={t("finance.txType")}
          className={inputClass}
          value={draft.type}
          onChange={(event) => onChange({ ...draft, type: event.target.value })}
        >
          <option value="">{t("finance.allTypes")}</option>
          <option value="income">{t("finance.income")}</option>
          <option value="expense">{t("finance.expense")}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.account")}
        <select
          aria-label={t("finance.account")}
          className={inputClass}
          value={draft.account_id}
          onChange={(event) => onChange({ ...draft, account_id: event.target.value })}
        >
          <option value="">{t("finance.allAccounts")}</option>
          {accountsLoading ? <option value="" disabled>{t("common.loading")}</option> : null}
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.category")}
        <select
          aria-label={t("finance.category")}
          className={inputClass}
          value={draft.category_id}
          onChange={(event) => onChange({ ...draft, category_id: event.target.value })}
        >
          <option value="">{t("finance.allCategories")}</option>
          {categoriesLoading ? <option value="" disabled>{t("common.loading")}</option> : null}
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end gap-2">
        <button
          type="submit"
          className="rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
        >
          {t("finance.apply")}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-transparent px-3 py-2 text-sm text-instrument/60 transition-colors hover:text-instrument"
        >
          {t("finance.clear")}
        </button>
      </div>
    </form>
  );
}

function LedgerTable({ rows, locale }: { rows: LedgerRow[]; locale: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-xl border-collapse text-sm">
        <thead>
          <tr className="border-b border-hull text-left font-display text-[11px] uppercase tracking-widest text-instrument/60">
            <th scope="col" className="px-3 py-2 font-medium">{t("finance.date")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("finance.description")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("finance.txType")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("finance.amount")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-hull/60 last:border-0">
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums text-instrument/70">
                {row.occurred_on}
              </td>
              <td className="max-w-48 truncate px-3 py-2">{row.description}</td>
              <td className="px-3 py-2">
                <span
                  className={`inline-block rounded-full border px-2 py-0.5 font-display text-[11px] tracking-wide ${
                    row.type === "income"
                      ? "border-flow/40 text-flow"
                      : "border-signal/40 text-signal"
                  }`}
                >
                  {row.type}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                {formatMoney(row.amount, { locale, currency: row.currency })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LedgerSkeleton() {
  return (
    <div role="status" aria-label={t("finance.loadingTransactions")} aria-busy="true" className="flex flex-col gap-2">
      {[0, 1, 2].map((n) => (
        <div key={n} className="h-10 animate-pulse rounded-md bg-hull/60" />
      ))}
    </div>
  );
}

function LedgerPages({ filters, locale }: { filters: TransactionFilters; locale: string }) {
  const first = useTransactionsPage(filters, null);
  const [extraItems, setExtraItems] = useState<TransactionWire[]>([]);
  const [tailCursor, setTailCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const firstPage = first.data ?? null;
  const liveCursor = tailCursor === undefined ? (firstPage?.next_cursor ?? null) : tailCursor;
  const items = [...(firstPage?.items ?? []), ...extraItems];
  const total = firstPage?.total_count ?? 0;

  async function handleLoadMore() {
    if (!liveCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const page = await fetchTransactionsPage(filters, liveCursor);
      setExtraItems((prev) => [...prev, ...page.items]);
      setTailCursor(page.next_cursor);
    } catch {
      setLoadError(t("finance.loadMoreFailed"));
    } finally {
      setLoadingMore(false);
    }
  }

  if (first.isLoading) {
    return <LedgerSkeleton />;
  }

  if (first.error || !firstPage) {
    return (
      <div role="alert" className="rounded-lg border border-alert/50 bg-alert/10 p-4">
        <p className="font-display text-sm font-semibold">{t("finance.ledgerLoadFailed")}</p>
        <p className="mt-1 text-xs text-instrument/70">{t("finance.ledgerLoadFailedHint")}</p>
        <button
          type="button"
          onClick={() => void first.mutate()}
          className="mt-3 rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title={t("finance.noTransactions")}
        hint={t("finance.noTransactionsHint")}
      />
    );
  }

  return (
    <div>
      <p aria-live="polite" className="mb-3 text-xs text-instrument/60">
        {t("finance.showingCount", { shown: items.length, total })}
      </p>
      <LedgerTable rows={toLedgerRows(items)} locale={locale} />
      {loadError ? (
        <p role="alert" className="mt-3 text-xs text-alert">{loadError}</p>
      ) : null}
      {liveCursor ? (
        <button
          type="button"
          onClick={() => void handleLoadMore()}
          disabled={loadingMore}
          className="mt-4 rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal disabled:opacity-50"
        >
          {loadingMore ? t("common.loading") : t("finance.loadMore")}
        </button>
      ) : null}
    </div>
  );
}

export default function TransactionsLedger({ locale }: { locale: string }) {
  const [draft, setDraft] = useState<LedgerDraft>(EMPTY_DRAFT);
  const [applied, setApplied] = useState<TransactionFilters>({ limit: 50 });
  const accountsQuery = useAccounts();
  const categoriesQuery = useFinanceCategories();
  const accounts = toAccountOptions(
    (accountsQuery.data ?? []).map((row) => ({ id: row.id, name: row.name })),
  );
  const categories = toCategoryOptions(categoriesQuery.data ?? []);

  return (
    <section aria-label={t("finance.ledgerRegion")} className="rounded-xl border border-hull bg-hull/40 p-5">
      <h2 className="font-display text-base font-semibold tracking-wide">{t("finance.ledgerTitle")}</h2>
      <p className="mt-1 text-sm text-instrument/60">{t("finance.ledgerSubtitle")}</p>
      <div className="mt-4">
        <LedgerFilters
          draft={draft}
          onChange={setDraft}
          onApply={() => setApplied(toAppliedFilters(draft))}
          onClear={() => {
            setDraft(EMPTY_DRAFT);
            setApplied({ limit: 50 });
          }}
          accounts={accounts}
          categories={categories}
          accountsLoading={accountsQuery.isLoading}
          categoriesLoading={categoriesQuery.isLoading}
        />
      </div>
      <div className="mt-4">
        <LedgerPages key={ledgerKey(applied)} filters={applied} locale={locale} />
      </div>
    </section>
  );
}
