import { deck } from "@/components/ui/deckStyles";

/**
 * Control Deck card shell shared by every Resumen block: the prototype chrome
 * (`deck.panel`) plus the section header row (title, subtitle, real action or
 * meta). The `<section aria-label={title}>` keeps the existing region contract
 * (`region / Últimos movimientos`, `region / Próximos pagos`, ...) intact.
 */
export default function DeckCard({
  title,
  hint,
  meta,
  action,
  className,
  headerClassName,
  children,
}: {
  title: string;
  hint?: string;
  /** Real counter / state pill rendered at the right of the header. */
  meta?: React.ReactNode;
  /** Real control rendered at the right of the header. */
  action?: React.ReactNode;
  /** Grid/order placement classes owned by the container. */
  className?: string;
  headerClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className={`${deck.panel} ${className ?? ""}`}>
      <div className={headerClassName ?? deck.sectionHeader}>
        <div className="min-w-0">
          <h2 className={deck.sectionTitle}>{title}</h2>
          {hint ? <p className={deck.sectionSubtitle}>{hint}</p> : null}
        </div>
        {meta || action ? (
          <div className="flex shrink-0 items-center gap-2">
            {meta}
            {action}
          </div>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * Dashed empty state from the prototypes: icon ball, title and hint, wrapped
 * in `role="status"` so assistive tech announces it like the shared
 * `EmptyState` does. Rendered only when the real data is empty (D10).
 */
export function DeckEmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div role="status" className={deck.emptyState}>
      <div className={deck.emptyIconBall}>{icon}</div>
      <p className={deck.emptyTitle}>{title}</p>
      {hint ? <p className={deck.emptyHint}>{hint}</p> : null}
    </div>
  );
}
