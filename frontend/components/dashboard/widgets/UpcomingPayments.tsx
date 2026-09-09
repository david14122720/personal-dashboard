"use client";
import { useSWRConfig } from "swr";
import EmptyState from "@/components/ui/EmptyState";
import { useDebts, useEvents, useSubscriptions } from "@/lib/api/dashboard";
import { toUpcomingPayments } from "@/lib/dashboard/transforms";
import { t } from "@/lib/i18n";
export default function UpcomingPayments() {
  const subs = useSubscriptions();
  const debts = useDebts();
  const events = useEvents(null, null);
  const { mutate } = useSWRConfig();
  if (subs.isLoading || debts.isLoading || events.isLoading) return <div role="status">{t("common.loading")}</div>;
  if (subs.error || debts.error || events.error) return <div role="alert"><p>{t("dashboard.loadFailed")}</p><button type="button" onClick={() => void mutate((k) => typeof k === "string" && k.startsWith("dashboard/"))}>{t("common.retry")}</button></div>;
  const items = toUpcomingPayments(subs.data, debts.data, events.data).slice(0, 7);
  if (items.length === 0) return <div><EmptyState title={t("dashboard.upcomingPaymentsEmpty")} /><a href="/dashboard/finance/">{t("dashboard.viewInFinance")}</a></div>;
  return <div><ul className="flex flex-col gap-2">{items.map((i) => <li key={i.id} className="flex justify-between gap-3 rounded-lg border border-hull px-3 py-2 text-sm"><span className="truncate">{i.title}</span><span className="shrink-0 font-mono text-xs tabular-nums text-instrument/60">{i.due}</span></li>)}</ul><a href="/dashboard/finance/" className="mt-2 inline-block text-xs text-signal underline-offset-2 hover:underline">{t("dashboard.viewInFinance")}</a></div>;
}
