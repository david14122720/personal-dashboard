"use client";
import { useSWRConfig } from "swr";
import EmptyState from "@/components/ui/EmptyState";
import { useGoals } from "@/lib/api/dashboard";
import { toGoalProgress } from "@/lib/dashboard/transforms";
import { t } from "@/lib/i18n";
export default function GoalProgress() {
  const g = useGoals();
  const { mutate } = useSWRConfig();
  if (g.isLoading) return <div role="status" aria-label={t("common.loading")} className="animate-pulse rounded-xl border border-hull bg-hull/40 p-5"><div className="h-4 w-24 rounded bg-hull" /></div>;
  if (g.error) return <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-4 sm:p-5"><p className="text-sm text-instrument/70">{t("dashboard.loadFailed")}</p><button type="button" onClick={() => void mutate((k) => typeof k === "string" && k.startsWith("dashboard/"))} className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-hull px-3 font-display text-sm text-instrument-dim transition-colors hover:border-signal hover:text-signal">{t("common.retry")}</button></div>;
  const { goals } = toGoalProgress(g.data);
  if (goals.length === 0) return <div className="animate-fade-in motion-reduce:animate-none"><EmptyState title={t("productivity.noGoals")} /><a href="/dashboard/productivity/" className="mt-2 inline-flex min-h-11 items-center text-xs text-signal underline-offset-2 hover:underline">{t("dashboard.viewInProductivity")}</a></div>;
  return <div className="animate-fade-in motion-reduce:animate-none"><p className="text-xs text-slate-400">{t("dashboard.goalVsSavings")}</p><ul className="mt-2 flex flex-col gap-2">{goals.map((x) => <li key={x.id} className="rounded-lg border border-hull px-3 py-2 text-sm"><span>{t("productivity.goals")}: {x.name} · {x.pct}%</span><span aria-hidden="true" className="mt-1 block h-1.5 rounded bg-flow" style={{ width: `${x.pct}%` }} /></li>)}</ul><a href="/dashboard/productivity/" className="mt-2 inline-flex min-h-11 items-center text-xs text-signal underline-offset-2 hover:underline">{t("dashboard.viewInProductivity")}</a></div>;
}
