"use client";

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
  children,
}: {
  title: string;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  panelId: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-full flex-col rounded-xl border border-hull bg-panel/90 p-4 sm:p-5">
      <h2 className="font-display text-base font-medium tracking-wide">
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
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
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
