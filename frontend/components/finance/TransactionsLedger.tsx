"use client";

import { useState } from "react";
import EmptyState from "@/components/ui/EmptyState";
import {
  fetchTransactionsPage,
  useTransactionsPage,
  type TransactionFilters,
  type TransactionWire,
} from "@/lib/api/finance";
import { formatMoney } from "@/lib/api/money";
import { ledgerKey, toLedgerRows, type LedgerRow } from "@/lib/finance/finance";

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
}: {
  draft: LedgerDraft;
  onChange: (next: LedgerDraft) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  return (
    <form
      aria-label="Transaction filters"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        From
        <input
          type="date"
          aria-label="From date"
          className={inputClass}
          value={draft.from}
          onChange={(event) => onChange({ ...draft, from: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        To
        <input
          type="date"
          aria-label="To date"
          className={inputClass}
          value={draft.to}
          onChange={(event) => onChange({ ...draft, to: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        Type
        <select
          aria-label="Transaction type"
          className={inputClass}
          value={draft.type}
          onChange={(event) => onChange({ ...draft, type: event.target.value })}
        >
          <option value="">All types</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        Account ID
        <input
          aria-label="Account ID"
          placeholder="uuid"
          className={inputClass}
          value={draft.account_id}
          onChange={(event) => onChange({ ...draft, account_id: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        Category ID
        <input
          aria-label="Category ID"
          placeholder="uuid"
          className={inputClass}
          value={draft.category_id}
          onChange={(event) => onChange({ ...draft, category_id: event.target.value })}
        />
      </label>
      <div className="flex items-end gap-2">
        <button
          type="submit"
          className="rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-transparent px-3 py-2 text-sm text-instrument/60 transition-colors hover:text-instrument"
        >
          Clear
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
            <th scope="col" className="px-3 py-2 font-medium">Date</th>
            <th scope="col" className="px-3 py-2 font-medium">Description</th>
            <th scope="col" className="px-3 py-2 font-medium">Type</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
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
    <div role="status" aria-label="Loading transactions" aria-busy="true" className="flex flex-col gap-2">
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
      setLoadError("Could not load more transactions. Try again.");
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
        <p className="font-display text-sm font-semibold">Transactions failed to load</p>
        <p className="mt-1 text-xs text-instrument/70">Check your connection and retry.</p>
        <button
          type="button"
          onClick={() => void first.mutate()}
          className="mt-3 rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
        >
          Retry
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No transactions yet"
        hint="Adjust the filters or record your first entry."
      />
    );
  }

  return (
    <div>
      <p aria-live="polite" className="mb-3 text-xs text-instrument/60">
        Showing {items.length} of {total} transactions
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
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </div>
  );
}

export default function TransactionsLedger({ locale }: { locale: string }) {
  const [draft, setDraft] = useState<LedgerDraft>(EMPTY_DRAFT);
  const [applied, setApplied] = useState<TransactionFilters>({ limit: 50 });

  return (
    <section aria-label="Transactions ledger" className="rounded-xl border border-hull bg-hull/40 p-5">
      <h2 className="font-display text-base font-semibold tracking-wide">Transactions</h2>
      <p className="mt-1 text-sm text-instrument/60">Newest first. Pages stay stable as new entries arrive.</p>
      <div className="mt-4">
        <LedgerFilters
          draft={draft}
          onChange={setDraft}
          onApply={() => setApplied(toAppliedFilters(draft))}
          onClear={() => {
            setDraft(EMPTY_DRAFT);
            setApplied({ limit: 50 });
          }}
        />
      </div>
      <div className="mt-4">
        <LedgerPages key={ledgerKey(applied)} filters={applied} locale={locale} />
      </div>
    </section>
  );
}
