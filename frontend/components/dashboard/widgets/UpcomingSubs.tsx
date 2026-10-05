"use client";
import Link from "next/link";
import { useSWRConfig } from "swr";
import EmptyState from "@/components/ui/EmptyState";
import { useSubscriptions } from "@/lib/api/finance";
import { formatMoney, toNumber } from "@/lib/api/money";
import { isPaidThisCycle, todayInBogota } from "@/lib/finance/finance";
import { t } from "@/lib/i18n";

/**
 * «Próximas suscripciones»: active subscriptions with
 * `next_billing_on >= today` ascending, top 5, showing name, COP amount
 * and due date plus the render-derived paid state. Independent Spanish
 * loading/error/empty; retry revalidates only `finance/subscriptions`.
 */
export default function UpcomingSubs() {
  const subs = useSubscriptions();
  const { mutate } = useSWRConfig();

  if (subs.isLoading) {
    return (
      <div
        role="status"
        aria-label={t("common.loading")}
        className="animate-pulse rounded-xl border border-hull bg-hull/40 p-5"
      >
        <div className="h-4 w-24 rounded bg-hull" />
      </div>
    );
  }
  if (subs.error) {
    return (
      <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-4 sm:p-5">
        <p className="text-sm text-instrument/70">{t("dashboard.sectionLoadFailed")}</p>
        <button
          type="button"
          onClick={() => void mutate("finance/subscriptions")}
          className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-hull px-3 font-display text-sm text-instrument-dim transition-colors hover:border-signal hover:text-signal"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  const today = todayInBogota();
  const rows = (subs.data ?? [])
    .filter(
      (sub) =>
        sub.is_active === true &&
        sub.next_billing_on !== null &&
        sub.next_billing_on !== undefined &&
        sub.next_billing_on >= today,
    )
    .sort((a, b) =>
      (a.next_billing_on as string) < (b.next_billing_on as string) ? -1 : 1,
    )
    .slice(0, 5);

  if (rows.length === 0) {
    return (
      <div className="animate-fade-in motion-reduce:animate-none">
        <EmptyState
          title={t("dashboard.upcomingSubscriptionsEmpty")}
          hint={t("finance.noSubscriptionsHint")}
        />
        <Link
          href="/dashboard/finance/"
          className="mt-2 inline-flex min-h-11 items-center text-xs text-signal underline-offset-2 hover:underline"
        >
          {t("dashboard.viewInFinance")}
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-fade-in motion-reduce:animate-none">
      <ul className="flex flex-col gap-2">
        {rows.map((sub) => {
          const paid = isPaidThisCycle(
            {
              last_paid_on: sub.last_paid_on ?? null,
              next_billing_on: sub.next_billing_on,
            },
            today,
          );
          return (
            <li
              key={sub.id}
              className="flex flex-col gap-3 rounded-lg border border-hull px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="min-w-0">
                <span className="line-clamp-2 sm:block sm:truncate">{sub.name}</span>
                <span className="mt-0.5 block truncate text-xs text-slate-400">
                  {paid
                    ? t("finance.paidThisCycle")
                    : (sub.next_billing_on as string)}
                </span>
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums">
                {formatMoney(toNumber(sub.price))}
              </span>
            </li>
          );
        })}
      </ul>
      <Link
        href="/dashboard/finance/"
        className="mt-2 inline-flex min-h-11 items-center text-xs text-signal underline-offset-2 hover:underline"
      >
        {t("dashboard.viewInFinance")}
      </Link>
    </div>
  );
}
