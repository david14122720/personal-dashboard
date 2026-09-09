"use client";
import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import NotificationList from "./NotificationList";
import { useNotifications } from "./useNotifications";

/** Campanita del header del home: badge = vencidas + 7d − muteados − ocultos. Teclado + Esc + foco visible, SSR-safe. */
export default function NotificationBell() {
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
  return (
    <div className="relative">
      <button ref={btnRef} type="button" aria-label={t("notifications.bellLabel", { n: count })} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)} className="relative rounded-md border border-hull px-3 py-2 font-display text-sm text-instrument transition-colors hover:border-signal hover:text-signal focus-visible:outline-2 focus-visible:outline-signal">
        <span aria-hidden="true">🔔</span><span className="ml-2">{t("notifications.bell")}</span>
        {count > 0 ? <span data-testid="p8-badge" className="ml-2 rounded-full bg-signal px-2 py-0.5 font-mono text-xs tabular-nums text-hull">{count}</span> : null}
      </button>
      {open ? <div role="dialog" aria-label={t("notifications.bell")} className="absolute right-0 z-20 mt-2 w-80 max-w-[90vw] rounded-xl border border-hull bg-hull/40 p-4"><NotificationList overdue={overdue} upcoming={upcoming} muted={muted} onToggleMute={toggleMute} /></div> : null}
    </div>
  );
}
