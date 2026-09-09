"use client";
import EmptyState from "@/components/ui/EmptyState";
import { formatMoney } from "@/lib/api/money";
import type { NotificationItem } from "@/lib/api/dashboard";
import { t } from "@/lib/i18n";

const financeHref = "/dashboard/finance/";
const prodHref = "/dashboard/productivity/";
const byDueAsc = (a: NotificationItem, b: NotificationItem) => new Date(a.due).getTime() - new Date(b.due).getTime();
function Row({ item, muted, onToggleMute }: { item: NotificationItem; muted: Record<string, boolean | true>; onToggleMute: (id: string) => void }) {
  const isMuted = Boolean(muted[item.id]);
  const finance = item.kind === "debt" || item.kind === "subscription";
  return (
    <li className={`flex items-center justify-between gap-3 rounded-lg border border-hull px-3 py-2 ${isMuted ? "opacity-60" : ""}`}>
      <div className="min-w-0">
        <p className="truncate text-sm">{item.title}</p>
        <p className="mt-0.5 text-xs text-instrument/60">{item.amount !== undefined ? t("notifications.amountDue", { amount: formatMoney(item.amount), date: item.due }) : t("notifications.dueOn", { date: item.due })}</p>
        <a href={finance ? financeHref : prodHref} className="mt-0.5 inline-block text-xs text-signal underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-signal">{finance ? t("dashboard.viewInFinance") : t("dashboard.viewInProductivity")}</a>
      </div>
      <button type="button" role="switch" aria-checked={!isMuted} aria-label={`${isMuted ? t("notifications.unmute") : t("notifications.mute")}: ${item.title}`} onClick={() => onToggleMute(item.id)} className="shrink-0 rounded-md border border-hull px-2 py-1 font-display text-xs text-instrument/70 transition-colors hover:border-signal hover:text-signal focus-visible:outline-2 focus-visible:outline-signal">
        {isMuted ? t("notifications.unmute") : t("notifications.mute")}
      </button>
    </li>
  );
}
/** Dos secciones ordenadas con EmptyState ES exacto y ver-en-sección por fila. */
export default function NotificationList({ overdue, upcoming, muted, onToggleMute }: { overdue: NotificationItem[]; upcoming: NotificationItem[]; muted: Record<string, boolean | true>; onToggleMute: (id: string) => void }) {
  const over = [...overdue].sort(byDueAsc);
  const up = [...upcoming].sort(byDueAsc);
  return (
    <div className="flex flex-col gap-4">
      <section aria-label={t("notifications.overdue")}>
        <h3 className="font-display text-sm font-semibold tracking-wide">{t("notifications.overdue")}</h3>
        <div className="mt-2">{over.length === 0 ? <EmptyState title={t("notifications.noOverdue")} /> : <ul className="flex flex-col gap-2">{over.map((i) => <Row key={i.id} item={i} muted={muted} onToggleMute={onToggleMute} />)}</ul>}</div>
      </section>
      <section aria-label={t("notifications.upcomingCharges")}>
        <h3 className="font-display text-sm font-semibold tracking-wide">{t("notifications.upcomingCharges")}</h3>
        <div className="mt-2">{up.length === 0 ? <EmptyState title={t("notifications.noUpcoming")} /> : <ul className="flex flex-col gap-2">{up.map((i) => <Row key={i.id} item={i} muted={muted} onToggleMute={onToggleMute} />)}</ul>}</div>
      </section>
    </div>
  );
}
