"use client";
import { useCallback, useEffect, useState } from "react";
import { isWidgetVisible, resolveDashboardLayout, useDebts, useEvents, usePreferences, useSubscriptions, useTasks, type NotificationItem } from "@/lib/api/dashboard";
import { toNotificationCount, toNotificationItems, toOverdueItems, toUpcomingPayments } from "@/lib/dashboard/transforms";

export const MUTED_KEY = "p8-notif-muted";
export type MutedMap = Record<string, true>;
function readMuted(): MutedMap {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(MUTED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v === true)) as MutedMap;
  } catch { return {}; }
}
const overdueVisible = (layout: ReturnType<typeof resolveDashboardLayout>, i: NotificationItem) =>
  i.kind === "task" ? isWidgetVisible(layout, "pending-tasks") : i.kind === "debt" ? isWidgetVisible(layout, "pending-debts") : isWidgetVisible(layout, "upcoming-events");
const upcomingVisible = (layout: ReturnType<typeof resolveDashboardLayout>, i: NotificationItem) => {
  if (!isWidgetVisible(layout, "upcoming-payments")) return false;
  return i.kind === "subscription" ? isWidgetVisible(layout, "active-subs") : i.kind === "debt" ? isWidgetVisible(layout, "pending-debts") : isWidgetVisible(layout, "upcoming-events");
};
/** Deriva avisos de hooks S3, cero endpoints nuevos. Vencidas + 7d − muteados − ocultos. SSR-safe. */
export function useNotifications(now: Date = new Date()) {
  const prefs = usePreferences();
  const layout = resolveDashboardLayout(prefs.data);
  const debtsOn = isWidgetVisible(layout, "pending-debts") || isWidgetVisible(layout, "upcoming-payments");
  const subsOn = isWidgetVisible(layout, "active-subs") || isWidgetVisible(layout, "upcoming-payments");
  const tasksOn = isWidgetVisible(layout, "pending-tasks");
  const eventsOn = isWidgetVisible(layout, "upcoming-events") || isWidgetVisible(layout, "upcoming-payments");
  const debts = useDebts(debtsOn);
  const subs = useSubscriptions(subsOn);
  const tasks = useTasks("overdue", tasksOn);
  const events = useEvents(null, null, eventsOn);
  const [muted, setMuted] = useState<MutedMap>(() => readMuted());
  useEffect(() => { setMuted(readMuted()); }, []);
  const toggleMute = useCallback((id: string) => {
    setMuted((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id]; else next[id] = true;
      try { if (typeof window !== "undefined") window.localStorage.setItem(MUTED_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, []);
  const overdue = toOverdueItems(tasks.data, debts.data, events.data, now).filter((i) => overdueVisible(layout, i));
  const upcoming = toUpcomingPayments(subs.data, debts.data, events.data, now).filter((i) => upcomingVisible(layout, i));
  const items = toNotificationItems(overdue, upcoming);
  return { overdue, upcoming, items, count: toNotificationCount(items, muted, null), muted, toggleMute };
}
