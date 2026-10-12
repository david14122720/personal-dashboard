"use client";

import { deck } from "@/components/ui/deckStyles";

/**
 * Shared disclosure shell for the dashboard charts: `h2 > button` with
 * `aria-expanded`/`aria-controls`, a `hidden` panel target that always stays
 * in the DOM, and children mounted only while open. Presentational only —
 * each section owns its own `open` state, so toggling one disclosure never
 * affects the other. No state here on purpose.
 */
export default function DashboardDisclosure({
  title,
  hint,
  open,
  onToggle,
  panelId,
  className,
  children,
}: {
  title: string;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  panelId: string;
  /** Grid/order placement classes owned by the container. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`${deck.panel} flex h-full flex-col ${className ?? ""}`}>
      <div className={deck.sectionHeaderWrap}>
        <div className="min-w-0">
          <h2 className={deck.sectionTitle}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={onToggle}
              className="inline-flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-md text-left transition-colors hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            >
              {title}
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 8l5 5 5-5" />
              </svg>
            </button>
          </h2>
          {hint ? <p className={deck.sectionSubtitle}>{hint}</p> : null}
        </div>
      </div>
      <div
        id={panelId}
        hidden={!open}
        className="mt-4 flex-1 animate-fade-in motion-reduce:animate-none"
      >
        {open ? children : null}
      </div>
    </section>
  );
}
