"use client";
import { useSWRConfig } from "swr";
import EmptyState from "@/components/ui/EmptyState";
import { useEvents } from "@/lib/api/dashboard";
import { toUpcomingEvents } from "@/lib/dashboard/transforms";
import { t } from "@/lib/i18n";
export default function UpcomingEvents() {
  const { data, error, isLoading } = useEvents(null, null);
  const { mutate } = useSWRConfig();
  if (isLoading) return <div role="status">{t("common.loading")}</div>;
  if (error) return <div role="alert"><p>{t("dashboard.loadFailed")}</p><button type="button" onClick={() => void mutate((k) => typeof k === "string" && k.startsWith("dashboard/"))}>{t("common.retry")}</button></div>;
  const rows = toUpcomingEvents(data, new Date(), 14).slice(0, 7);
  if (rows.length === 0) return <div><EmptyState title={t("productivity.noEvents")} /><a href="/dashboard/productivity/">{t("dashboard.viewInProductivity")}</a></div>;
  return <div><ul className="flex flex-col gap-2">{rows.map((r) => <li key={r.id} className="flex justify-between gap-3 rounded-lg border border-hull px-3 py-2 text-sm"><span className="truncate">{r.title}</span><span className="shrink-0 font-mono text-xs tabular-nums text-instrument/60">{r.starts_at}</span></li>)}</ul><a href="/dashboard/productivity/" className="mt-2 inline-block text-xs text-signal underline-offset-2 hover:underline">{t("dashboard.viewInProductivity")}</a></div>;
}
