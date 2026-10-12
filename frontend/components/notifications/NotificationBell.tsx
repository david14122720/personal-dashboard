"use client";
import { useEffect, useRef, useState } from "react";
import { ghostButton, notificationCountPill } from "@/components/ui/deckStyles";
import { t } from "@/lib/i18n";
import NotificationList from "./NotificationList";
import { useNotifications } from "./useNotifications";

/** Inline bell glyph (D3: no icon font, no emoji, no CDN). */
function BellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M5 8.2a5 5 0 0110 0v3.3c0 .6.2 1.1.7 1.5l.8.7H3.5l.8-.7c.5-.4.7-.9.7-1.5V8.2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M8 16.2a2 2 0 004 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Notification surface in the shell: the design's `Avisos` button (bell + amber
 * ping + count pill) on desktop, an icon-only variant for the fixed mobile
 * header. Badge = vencidas + 7d − muteados − ocultos. Teclado + Esc + foco
 * visible, SSR-safe. Amber accent only when the real count is non-zero.
 */
export default function NotificationBell({ variant = "full" }: { variant?: "full" | "compact" }) {
  const { overdue, upcoming, count, muted, toggleMute } = useNotifications();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); btnRef.current?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open ]);
  const alerting = count > 0;
  const label = t("notifications.bellLabel", { n: count });
  // The compact variant lives in the fixed mobile header: anchor the panel to the
  // screen (right edge + below the bar) so a 320px panel is never clipped on a
  // 390px viewport by the button's own right edge.
  const dialogClass = `z-20 w-80 max-w-[90vw] rounded-xl border border-hair bg-card p-4 shadow-2xl ${
    variant === "compact"
      ? "fixed right-3 top-[calc(3.75rem+env(safe-area-inset-top,0px))]"
      : "absolute right-0 mt-2"
  }`;
  const dialog = open ? (
    <div role="dialog" aria-label={t("notifications.bell")} className={dialogClass}>
      <NotificationList overdue={overdue} upcoming={upcoming} muted={muted} onToggleMute={toggleMute} />
    </div>
  ) : null;

  if (variant === "compact") {
    return (
      <div className="relative">
        <button
          ref={btnRef}
          type="button"
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((v) => !v)}
          className="relative flex h-11 w-11 items-center justify-center rounded-full border border-hair bg-panel text-slate-300 transition-colors hover:bg-card hover:text-instrument focus-visible:outline-2 focus-visible:outline-signal"
        >
          <BellIcon className={`h-5 w-5 ${alerting ? "text-amber-400" : "text-slate-400"}`} />
          {alerting ? (
            <span
              data-testid="p8-badge"
              className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/15 px-1 font-mono text-[9px] font-bold tabular-nums text-amber-300"
            >
              {count}
            </span>
          ) : null}
        </button>
        {dialog}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className={ghostButton}
      >
        {alerting ? (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
          </span>
        ) : null}
        <BellIcon className={`h-4 w-4 ${alerting ? "text-amber-400" : "text-slate-400"}`} />
        <span>{t("notifications.bell")}</span>
        {alerting ? (
          <span data-testid="p8-badge" className={notificationCountPill}>{count}</span>
        ) : null}
      </button>
      {dialog}
    </div>
  );
}
