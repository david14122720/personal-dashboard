"use client";
import { useCallback, useSyncExternalStore } from "react";
import { isWidgetVisible, resolveDashboardLayout, useEvents, usePreferences, useSubscriptions, useTasks, type NotificationItem } from "@/lib/api/dashboard";
import { toNotificationCount, toNotificationItems, toOverdueItems, toUpcomingPayments } from "@/lib/dashboard/transforms";

export const MUTED_KEY = "p8-notif-muted";
export type MutedMap = Record<string, true>;
const EMPTY_MUTED: MutedMap = {};
function parseMuted(raw: string | null): MutedMap {
  if (!raw) return EMPTY_MUTED;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const kept = Object.entries(parsed).filter(([, v]) => v === true);
    return kept.length === 0 ? EMPTY_MUTED : (Object.fromEntries(kept) as MutedMap);
  } catch { return EMPTY_MUTED; }
}

/**
 * One muted set for the whole shell, read from `localStorage`.
 *
 * The shell mounts two bells (the compact one in the fixed mobile header and
 * the full one in the top bar). Each `useNotifications()` call used to own a
 * private `useState`, so muting in one left the other's badge stale until a
 * reload — visible when resizing across 768px. The external store below is the
 * single source of truth: every instance subscribes, a mute notifies them all,
 * and the snapshot is re-read from storage so an external write (a test
 * clearing storage) is never cached against. While the raw value is unchanged
 * the snapshot identity is stable, which is what `useSyncExternalStore`
 * requires; the server snapshot is the constant empty map (SSR-safe).
 */
let lastRaw: string | null | undefined;
let lastSnapshot: MutedMap = EMPTY_MUTED;
const mutedListeners = new Set<() => void>();

function readRaw(): string | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try { return window.localStorage.getItem(MUTED_KEY); } catch { return null; }
}

function mutedSnapshot(): MutedMap {
  const raw = readRaw();
  if (raw !== lastRaw) { lastRaw = raw; lastSnapshot = parseMuted(raw); }
  return lastSnapshot;
}

function mutedServerSnapshot(): MutedMap { return EMPTY_MUTED; }

function subscribeMuted(listener: () => void): () => void {
  mutedListeners.add(listener);
  return () => { mutedListeners.delete(listener); };
}

function persistMuted(next: MutedMap): void {
  try { if (typeof window !== "undefined") window.localStorage.setItem(MUTED_KEY, JSON.stringify(next)); } catch { /* noop */ }
  for (const listener of mutedListeners) listener();
}

const overdueVisible = (layout: ReturnType<typeof resolveDashboardLayout>, i: NotificationItem) =>
  i.kind === "task" ? isWidgetVisible(layout, "pending-tasks") : isWidgetVisible(layout, "upcoming-events");
// The removed active-subscriptions widget MUST NOT gate notifications:
// subscription items follow the surviving upcoming-payments widget only.
const upcomingVisible = (layout: ReturnType<typeof resolveDashboardLayout>, i: NotificationItem) => {
  if (!isWidgetVisible(layout, "upcoming-payments")) return false;
  return i.kind === "subscription" ? true : isWidgetVisible(layout, "upcoming-events");
};
/** Deriva avisos de hooks S3, cero endpoints nuevos. Vencidas + 7d − muteados − ocultos. SSR-safe. */
export function useNotifications(now: Date = new Date()) {
  const prefs = usePreferences();
  const layout = resolveDashboardLayout(prefs.data);
  const subsOn = isWidgetVisible(layout, "upcoming-payments");
  const tasksOn = isWidgetVisible(layout, "pending-tasks");
  const eventsOn = isWidgetVisible(layout, "upcoming-events") || isWidgetVisible(layout, "upcoming-payments");
  const subs = useSubscriptions(subsOn);
  const tasks = useTasks("overdue", tasksOn);
  const events = useEvents(null, null, eventsOn);
  // Shared across every bell instance (JD item 8): one muted set, one badge.
  const muted = useSyncExternalStore(subscribeMuted, mutedSnapshot, mutedServerSnapshot);
  const toggleMute = useCallback((id: string) => {
    const next = { ...mutedSnapshot() };
    if (next[id]) delete next[id]; else next[id] = true;
    persistMuted(next);
  }, []);
  const overdue = toOverdueItems(tasks.data, events.data, now).filter((i) => overdueVisible(layout, i));
  const upcoming = toUpcomingPayments(subs.data, events.data, now).filter((i) => upcomingVisible(layout, i));
  const items = toNotificationItems(overdue, upcoming);
  return { overdue, upcoming, items, count: toNotificationCount(items, muted, null), muted, toggleMute };
}
