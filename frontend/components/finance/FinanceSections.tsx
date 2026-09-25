import EmptyState from "@/components/ui/EmptyState";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/api/money";
import { ledDotClass } from "@/lib/dashboard/transforms";
import type {
  AccountCardView,
  CompactMoneyRow,
} from "@/lib/finance/finance";

/**
 * Pure presentational sections for the finance screens. Containers own all
 * SWR reads and money coercion; these components receive numbers only and
 * reuse the shared LED mapping (`ledDotClass`) for account `alert_level`
 * (ok|warn|high) enums.
 */

export function SectionShell({
  title,
  hint,
  children,
  span,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  span: string;
}) {
  return (
    <section aria-label={title} className={`flex h-full flex-col rounded-xl border border-slate-800/80 bg-[#0f131d]/90 p-5 ${span}`}>
      <h2 className="font-display text-base font-semibold text-white">{title}</h2>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
      <div className="mt-4 flex-1">{children}</div>
    </section>
  );
}

function LedDot({ label, status }: { label: string; status: string }) {
  return (
    <span
      role="img"
      aria-label={t("finance.ledStatus", { label, status })}
      title={status}
      className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${ledDotClass(status)}`}
    />
  );
}

function ProgressBar({ pct, status, label }: { pct: number; status: string; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-2 overflow-hidden rounded-full bg-deck"
    >
      <div className={`h-full rounded-full ${ledDotClass(status)}`} style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

export function AccountsList({
  accounts,
  locale,
  activeAccountId,
  onSelect,
}: {
  accounts: AccountCardView[];
  locale: string;
  /** Selected account id for the movements history filter (S-C). */
  activeAccountId?: string | null;
  /** Account-card click sets the history filter; undefined keeps cards inert. */
  onSelect?: (id: string | null) => void;
}) {
  if (accounts.length === 0) {
    return <EmptyState title={t("finance.noAccounts")} hint={t("finance.noAccountsHint")} />;
  }
  return (
    <ul className="flex flex-col gap-3">
      {accounts.map((account) => {
        const active = activeAccountId === account.id;
        const selectable = onSelect !== undefined;
        return (
          <li
            key={account.id}
            className={`rounded-lg border px-4 py-3 ${active ? "border-signal" : "border-hull"}`}
          >
            {selectable ? (
              <button
                type="button"
                onClick={() => onSelect(active ? null : account.id)}
                aria-pressed={active}
                aria-label={account.name}
                className="block min-h-[44px] w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              >
                <AccountCardBody account={account} locale={locale} />
              </button>
            ) : (
              <AccountCardBody account={account} locale={locale} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function AccountCardBody({ account, locale }: { account: AccountCardView; locale: string }) {
  return (
    <div className="flex items-start gap-2.5">
      {account.alertLevel ? <LedDot label={account.name} status={account.alertLevel} /> : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium">
            {account.name}
            <span className="ml-2 text-xs font-normal text-instrument/50">{account.type}</span>
          </p>
          <p className="font-mono text-sm tabular-nums">
            {formatMoney(account.balance, { locale, currency: account.currency })}
          </p>
        </div>
        {account.isCard && account.used !== null ? (
          <div className="mt-2">
            <ProgressBar
              pct={Math.min(1, Math.max(0, (account.usagePct ?? 0) / 100))}
              status={account.alertLevel ?? "ok"}
              label={t("finance.cardUsageLabel", { name: account.name })}
            />
            <p className="mt-1 font-mono text-[11px] tabular-nums text-instrument/60">
              {t("finance.usedAvailable", {
                used: formatMoney(account.used, { locale, currency: account.currency }),
                available: formatMoney(account.available ?? 0, { locale, currency: account.currency }),
                pct: (account.usagePct ?? 0).toFixed(1),
              })}
              {account.statementBalance !== null
                ? ` · ${t("finance.statementBalance", { amount: formatMoney(account.statementBalance, { locale, currency: account.currency }) })}`
                : ""}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CompactMoneyList({
  rows,
  locale,
  emptyTitle,
  emptyHint,
}: {
  rows: CompactMoneyRow[];
  locale: string;
  emptyTitle: string;
  emptyHint: string;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-hull px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate text-sm">{row.title}</p>
            {row.detail ? <p className="truncate text-xs text-instrument/60">{row.detail}</p> : null}
          </div>
          <p className="shrink-0 font-mono text-sm tabular-nums">
            {formatMoney(row.amount, { locale, currency: row.currency })}
          </p>
        </li>
      ))}
    </ul>
  );
}

