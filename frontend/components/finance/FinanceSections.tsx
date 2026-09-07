import EmptyState from "@/components/ui/EmptyState";
import { formatMoney } from "@/lib/api/money";
import { ledDotClass } from "@/lib/dashboard/transforms";
import type {
  AccountCardView,
  BudgetView,
  CompactMoneyRow,
  SavingsView,
} from "@/lib/finance/finance";

/**
 * Pure presentational sections for the finance screens. Containers own all
 * SWR reads and money coercion; these components receive numbers only and
 * reuse the shared LED mapping (`ledDotClass`) for budget `status`
 * (ok|warn|over) and account `alert_level` (ok|warn|high) enums.
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
    <section aria-label={title} className={`rounded-xl border border-hull bg-hull/40 p-5 ${span}`}>
      <h2 className="font-display text-base font-semibold tracking-wide">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-instrument/60">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function LedDot({ label, status }: { label: string; status: string }) {
  return (
    <span
      role="img"
      aria-label={`${label} status ${status}`}
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

export function BudgetsList({ budgets, locale }: { budgets: BudgetView[]; locale: string }) {
  if (budgets.length === 0) {
    return <EmptyState title="No budgets yet" hint="Create a budget to track spend against it." />;
  }
  return (
    <ul className="flex flex-col gap-3">
      {budgets.map((budget) => (
        <li key={budget.id} className="rounded-lg border border-hull px-4 py-3">
          <div className="flex items-start gap-2.5">
            <LedDot label={budget.label} status={budget.status} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="truncate text-sm font-medium">{budget.label}</p>
                <p className="font-mono text-sm tabular-nums">
                  {formatMoney(budget.spent, { locale, currency: budget.currency })}
                  <span className="text-instrument/50">
                    {" "}· {formatMoney(budget.remaining, { locale, currency: budget.currency })} left
                  </span>
                </p>
              </div>
              <div className="mt-2">
                <ProgressBar pct={budget.pct} status={budget.status} label={`${budget.label} spend`} />
              </div>
              <p className="mt-1 font-mono text-[11px] tabular-nums text-instrument/60">
                {Math.round(budget.pct * 100)}% spent · {budget.status}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AccountsList({ accounts, locale }: { accounts: AccountCardView[]; locale: string }) {
  if (accounts.length === 0) {
    return <EmptyState title="No accounts yet" hint="Add an account to see balances here." />;
  }
  return (
    <ul className="flex flex-col gap-3">
      {accounts.map((account) => (
        <li key={account.id} className="rounded-lg border border-hull px-4 py-3">
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
                    label={`${account.name} card usage`}
                  />
                  <p className="mt-1 font-mono text-[11px] tabular-nums text-instrument/60">
                    {formatMoney(account.used, { locale, currency: account.currency })} used ·{" "}
                    {formatMoney(account.available ?? 0, { locale, currency: account.currency })}{" "}
                    available · {(account.usagePct ?? 0).toFixed(1)}%
                    {account.statementBalance !== null
                      ? ` · statement ${formatMoney(account.statementBalance, { locale, currency: account.currency })}`
                      : ""}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
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

export function SavingsList({ goals, locale }: { goals: SavingsView[]; locale: string }) {
  if (goals.length === 0) {
    return <EmptyState title="No savings goals yet" hint="Create a goal to track progress here." />;
  }
  return (
    <ul className="flex flex-col gap-3">
      {goals.map((goal) => (
        <li key={goal.id} className="rounded-lg border border-hull px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium">
              {goal.title}
              {goal.completed ? (
                <span className="ml-2 rounded-full border border-flow/40 px-2 py-0.5 font-display text-[11px] text-flow">
                  completed
                </span>
              ) : null}
            </p>
            <p className="font-mono text-sm tabular-nums">
              {formatMoney(goal.amount, { locale, currency: goal.currency })}
            </p>
          </div>
          {goal.detail ? <p className="mt-0.5 text-xs text-instrument/60">{goal.detail}</p> : null}
          <div className="mt-2">
            <ProgressBar
              pct={goal.progress}
              status={goal.completed ? "ok" : goal.progress >= 0.7 ? "warn" : "ok"}
              label={`${goal.title} progress`}
            />
          </div>
          <p className="mt-1 font-mono text-[11px] tabular-nums text-instrument/60">
            {Math.round(goal.progress * 100)}% saved
          </p>
        </li>
      ))}
    </ul>
  );
}
