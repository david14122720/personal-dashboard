"use client";

import { useState } from "react";
import EmptyState from "@/components/ui/EmptyState";
import {
  fetchTransfersPage,
  useTransfersPage,
  type TransferFilters,
  type TransferHistoryWire,
} from "@/lib/api/finance";
import { useAccounts } from "@/lib/api/dashboard";
import { formatMoney } from "@/lib/api/money";
import { t } from "@/lib/i18n";
import { toTransferRows, transferKey, type TransferRow } from "@/lib/finance/finance";

/**
 * Transfer history: keyset-paginated list of grouped transfers.
 * Account ids resolve to names via the accounts list — UUIDs never render.
 * The first page loads via SWR; "Load more" appends subsequent pages with the
 * opaque `next_cursor` verbatim.
 */

const inputClass =
  "w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument placeholder:text-instrument/40 focus:border-signal focus:outline-none";

function accountNameById(accounts: { id: string; name: string }[]): Map<string, string> {
  return new Map(accounts.map((account) => [account.id, account.name]));
}

function TransferTable({
  rows,
  names,
  locale,
}: {
  rows: TransferRow[];
  names: Map<string, string>;
  locale: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-xl border-collapse text-sm">
        <thead>
          <tr className="border-b border-hull text-left font-display text-[11px] uppercase tracking-widest text-instrument/60">
            <th scope="col" className="px-3 py-2 font-medium">
              {t("finance.date")}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("finance.newTransfer")}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("finance.description")}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t("finance.amount")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const from = names.get(row.from_account_id) ?? row.from_account_id;
            const to = names.get(row.to_account_id) ?? row.to_account_id;
            return (
              <tr key={row.id} className="border-b border-hull/60 last:border-0">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums text-instrument/70">
                  {row.occurred_on}
                </td>
                <td className="max-w-48 truncate px-3 py-2">
                  {t("finance.transferDirection", { from, to })}
                </td>
                <td className="max-w-48 truncate px-3 py-2">{row.description}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                  {formatMoney(row.amount, { locale, currency: row.currency })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TransferSkeleton() {
  return (
    <div
      role="status"
      aria-label={t("finance.loadingTransfers")}
      aria-busy="true"
      className="flex flex-col gap-2"
    >
      {[0, 1, 2].map((n) => (
        <div key={n} className="h-10 animate-pulse rounded-md bg-hull/60" />
      ))}
    </div>
  );
}

function TransferPages({ filters, locale }: { filters: TransferFilters; locale: string }) {
  const first = useTransfersPage(filters, null);
  const accountsQuery = useAccounts();
  const [extraItems, setExtraItems] = useState<TransferHistoryWire[]>([]);
  const [tailCursor, setTailCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const firstPage = first.data ?? null;
  const liveCursor = tailCursor === undefined ? (firstPage?.next_cursor ?? null) : tailCursor;
  const items = [...(firstPage?.items ?? []), ...extraItems];
  const total = firstPage?.total_count ?? 0;
  const names = accountNameById(
    (accountsQuery.data ?? []).map((row) => ({ id: row.id, name: row.name })),
  );

  async function handleLoadMore(): Promise<void> {
    if (!liveCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const page = await fetchTransfersPage(filters, liveCursor);
      setExtraItems((prev) => [...prev, ...page.items]);
      setTailCursor(page.next_cursor);
    } catch {
      setLoadError(t("finance.loadMoreFailed"));
    } finally {
      setLoadingMore(false);
    }
  }

  if (first.isLoading) {
    return <TransferSkeleton />;
  }

  if (first.error || !firstPage) {
    return (
      <div role="alert" className="rounded-lg border border-alert/50 bg-alert/10 p-4">
        <p className="font-display text-sm font-semibold">{t("finance.transfersLoadFailed")}</p>
        <p className="mt-1 text-xs text-instrument/70">{t("finance.transfersLoadFailedHint")}</p>
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
    return <EmptyState title={t("finance.noTransfers")} hint={t("finance.noTransfersHint")} />;
  }

  return (
    <div>
      <p aria-live="polite" className="mb-3 text-xs text-instrument/60">
        {t("finance.showingTransfers", { shown: items.length, total })}
      </p>
      <TransferTable rows={toTransferRows(items)} names={names} locale={locale} />
      {loadError ? (
        <p role="alert" className="mt-3 text-xs text-alert">
          {loadError}
        </p>
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

export default function TransferHistory({ locale }: { locale: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState<TransferFilters>({ limit: 50 });

  return (
    <section
      aria-label={t("finance.transfersRegion")}
      className="rounded-xl border border-hull bg-hull/40 p-5"
    >
      <h2 className="font-display text-base font-semibold tracking-wide">
        {t("finance.transfersTitle")}
      </h2>
      <p className="mt-1 text-sm text-instrument/60">{t("finance.transfersSubtitle")}</p>
      <form
        aria-label={t("finance.ledgerFilters")}
        className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
            limit: 50,
          });
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-instrument/60">
          {t("finance.from")}
          <input
            type="date"
            aria-label={t("finance.from")}
            className={inputClass}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-instrument/60">
          {t("finance.to")}
          <input
            type="date"
            aria-label={t("finance.to")}
            className={inputClass}
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
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
            onClick={() => {
              setFrom("");
              setTo("");
              setApplied({ limit: 50 });
            }}
            className="rounded-md border border-transparent px-3 py-2 text-sm text-instrument/60 transition-colors hover:text-instrument"
          >
            {t("finance.clear")}
          </button>
        </div>
      </form>
      <div className="mt-4">
        <TransferPages key={transferKey(applied)} filters={applied} locale={locale} />
      </div>
    </section>
  );
}
