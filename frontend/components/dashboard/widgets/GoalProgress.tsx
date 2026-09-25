"use client";
import { useSWRConfig } from "swr";
import EmptyState from "@/components/ui/EmptyState";
import { useGoals } from "@/lib/api/dashboard";
import { toGoalProgress } from "@/lib/dashboard/transforms";
import { t } from "@/lib/i18n";
export default function GoalProgress() {
  const g = useGoals();
  const { mutate } = useSWRConfig();
  if (g.isLoading) return <div role="status">{t("common.loading")}</div>;
  if (g.error) return <div role="alert"><p>{t("dashboard.loadFailed")}</p><button type="button" onClick={() => void mutate((k) => typeof k === "string" && k.startsWith("dashboard/"))}>{t("common.retry")}</button></div>;
  const { goals } = toGoalProgress(g.data);
  if (goals.length === 0) return <div><EmptyState title={t("productivity.noGoals")} /><a href="/dashboard/productivity/">{t("dashboard.viewInProductivity")}</a></div>;
  return <div><p className="text-xs text-instrument/60">{t("dashboard.goalVsSavings")}</p><ul className="mt-2 flex flex-col gap-2">{goals.map((x) => <li key={x.id} className="rounded-lg border border-hull px-3 py-2 text-sm"><span>{t("productivity.goals")}: {x.name} · {x.pct}%</span><span aria-hidden="true" className="mt-1 block h-1.5 rounded bg-flow" style={{ width: `${x.pct}%` }} /></li>)}</ul><a href="/dashboard/productivity/" className="mt-2 inline-block text-xs text-signal underline-offset-2 hover:underline">{t("dashboard.viewInProductivity")}</a></div>;
}
