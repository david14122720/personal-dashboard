/**
 * Shared empty state for aggregate-driven views. Rendered by the Recharts
 * wrappers (and list sections) when an endpoint returns no data points —
 * a localized message, never an error.
 */
export default function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div
      role="status"
      className="flex h-full min-h-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-hull px-4 py-8 text-center"
    >
      <p className="font-display text-sm font-medium tracking-wide text-instrument">{title}</p>
      {hint ? <p className="text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}
