import { deck } from "@/components/ui/deckStyles";

/**
 * Pure presentational shells for the finance screens. Containers own all SWR
 * reads and money coercion; these components receive numbers only.
 *
 * T4 moved every Finanzas card to `components/dashboard/DeckCard` (the
 * prototype card chrome shared with Resumen). T8e finished the job: the shell
 * now uses the shared panel/section-header recipes instead of the old chrome.
 * Its only consumer is the compare sub-route
 * (`app/dashboard/finance/compare/page.tsx`), so no other surface changes.
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
    <section aria-label={title} className={`${deck.panel} flex h-full flex-col ${span}`}>
      <div className={deck.sectionHeader}>
        <div className="min-w-0">
          <h2 className={deck.sectionTitle}>{title}</h2>
          {hint ? <p className={deck.sectionSubtitle}>{hint}</p> : null}
        </div>
      </div>
      <div className="mt-4 flex-1">{children}</div>
    </section>
  );
}
