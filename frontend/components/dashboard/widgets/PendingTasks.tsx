"use client";
import { useSWRConfig } from "swr";
import EmptyState from "@/components/ui/EmptyState";
import { useTasks } from "@/lib/api/dashboard";
import { toPendingTasks } from "@/lib/dashboard/transforms";
import { t } from "@/lib/i18n";
export default function PendingTasks() {
  const { data, error, isLoading } = useTasks(null);
  const { mutate } = useSWRConfig();
  if (isLoading) return <div role="status" aria-label={t("common.loading")} className="animate-pulse rounded-xl border border-hull bg-hull/40 p-5"><div className="h-4 w-24 rounded bg-hull" /></div>;
  if (error) return <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-4 sm:p-5"><p className="text-sm text-instrument/70">{t("dashboard.loadFailed")}</p><button type="button" onClick={() => void mutate((k) => typeof k === "string" && k.startsWith("dashboard/"))} className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-hull px-3 font-display text-sm text-instrument-dim transition-colors hover:border-signal hover:text-signal">{t("common.retry")}</button></div>;
  const rows = toPendingTasks(data).slice(0, 7);
  if (rows.length === 0) return <div className="animate-fade-in motion-reduce:animate-none"><EmptyState title={t("productivity.noTasks")} /><a href="/dashboard/productivity/" className="mt-2 inline-flex min-h-11 items-center text-xs text-signal underline-offset-2 hover:underline">{t("dashboard.viewInProductivity")}</a></div>;
  return <div className="animate-fade-in motion-reduce:animate-none"><ul className="flex flex-col gap-2">{rows.map((r) => <li key={r.id} className="flex flex-col gap-3 rounded-lg border border-hull px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"><span className="line-clamp-2 sm:block sm:truncate">{r.title}</span><span className="shrink-0 font-mono text-xs tabular-nums text-slate-400">{r.due_date ?? ""}</span></li>)}</ul><a href="/dashboard/productivity/" className="mt-2 inline-flex min-h-11 items-center text-xs text-signal underline-offset-2 hover:underline">{t("dashboard.viewInProductivity")}</a></div>;
}
