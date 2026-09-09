"use client";
import { useSWRConfig } from "swr";
import EmptyState from "@/components/ui/EmptyState";
import { formatMoney } from "@/lib/api/money";
import { useDebts } from "@/lib/api/dashboard";
import { toPendingDebts } from "@/lib/dashboard/transforms";
import { t } from "@/lib/i18n";
export default function PendingDebts() {
  const { data, error, isLoading } = useDebts();
  const { mutate } = useSWRConfig();
  if (isLoading) return <div role="status">{t("common.loading")}</div>;
  if (error) return <div role="alert"><p>{t("dashboard.loadFailed")}</p><button type="button" onClick={() => void mutate((k) => typeof k === "string" && k.startsWith("dashboard/"))}>{t("common.retry")}</button></div>;
  const rows = toPendingDebts(data).slice(0, 7);
  if (rows.length === 0) return <div><EmptyState title={t("finance.noDebts")} /><a href="/dashboard/finance/">{t("dashboard.viewInFinance")}</a></div>;
  return <div><ul className="flex flex-col gap-2">{rows.map((r) => <li key={r.id} className="flex justify-between gap-3 rounded-lg border border-hull px-3 py-2 text-sm"><span className="truncate">{r.name}</span><span className="shrink-0 font-mono text-xs tabular-nums">{formatMoney(r.pending)}</span></li>)}</ul><a href="/dashboard/finance/" className="mt-2 inline-block text-xs text-signal underline-offset-2 hover:underline">{t("dashboard.viewInFinance")}</a></div>;
}
