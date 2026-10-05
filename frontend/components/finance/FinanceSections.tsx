import EmptyState from "@/components/ui/EmptyState";
import { formatMoney } from "@/lib/api/money";
import type { CompactMoneyRow } from "@/lib/finance/finance";

/**
 * Pure presentational sections for the finance screens. Containers own all
 * SWR reads and money coercion; these components receive numbers only.
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
    <section aria-label={title} className={`flex h-full flex-col rounded-xl border border-hull bg-panel/90 p-4 sm:p-5 ${span}`}>
      <h2 className="font-display text-base font-medium tracking-wide">{title}</h2>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
      <div className="mt-4 flex-1">{children}</div>
    </section>
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
            {row.detail ? (
              <p className="line-clamp-2 text-xs text-instrument/60 sm:block sm:truncate">{row.detail}</p>
            ) : null}
          </div>
          <p className="shrink-0 font-mono text-sm tabular-nums">
            {formatMoney(row.amount, { locale, currency: row.currency })}
          </p>
        </li>
      ))}
    </ul>
  );
}

