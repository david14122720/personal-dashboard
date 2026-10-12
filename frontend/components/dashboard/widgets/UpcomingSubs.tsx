"use client";
import Link from "next/link";
import { useSWRConfig } from "swr";
import DeckCard, { DeckEmptyState } from "@/components/dashboard/DeckCard";
import { SectionError, SectionSkeleton } from "@/components/dashboard/SectionStates";
import { CalendarActionIcon } from "@/components/dashboard/icons";
import { deck } from "@/components/ui/deckStyles";
import { useSubscriptions } from "@/lib/api/finance";
import { formatMoney, toNumber } from "@/lib/api/money";
import { formatMovementDate, isPaidThisCycle, todayInBogota } from "@/lib/finance/finance";
import { t } from "@/lib/i18n";

/**
 * «Próximas suscripciones»: active subscriptions with
 * `next_billing_on >= today` ascending, top 5, showing name, COP amount
 * and due date plus the render-derived paid state, in the prototype card
 * chrome with its dashed empty state and footer link. Independent Spanish
 * loading/error/empty; retry revalidates only `finance/subscriptions`.
 */
export default function UpcomingSubs({ className }: { className?: string } = {}) {
  const subs = useSubscriptions();
  const { mutate } = useSWRConfig();

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

  return (
    <DeckCard
      title={t("dashboard.upcomingSubscriptionsTitle")}
      hint={t("dashboard.upcomingSubscriptionsHint")}
      className={className}
      meta={
        rows.length > 0 ? (
          <span className={deck.countPill}>{t("dashboard.recordsMeta", { n: rows.length })}</span>
        ) : null
      }
    >
      {subs.isLoading ? (
        <SectionSkeleton label={t("common.loading")} />
      ) : subs.error ? (
        <SectionError onRetry={() => void mutate("finance/subscriptions")} />
      ) : (
        <div className="animate-fade-in motion-reduce:animate-none">
          {rows.length === 0 ? (
            <DeckEmptyState
              icon={<CalendarActionIcon className="h-5 w-5 text-sky-400/70" />}
              title={t("dashboard.upcomingSubscriptionsEmpty")}
              hint={t("dashboard.upcomingSubscriptionsEmptyHint")}
            />
          ) : (
            <ul className="flex flex-col gap-2.5">
              {rows.map((sub) => {
                const paid = isPaidThisCycle(
                  {
                    last_paid_on: sub.last_paid_on ?? null,
                    next_billing_on: sub.next_billing_on,
                  },
                  today,
                );
                return (
                  <li key={sub.id} className={deck.listRow}>
                    <div className="flex items-start gap-3 sm:items-center">
                      <span
                        className={`${deck.rowIconTile} border-sky-500/20 bg-sky-500/10 text-sky-400`}
                      >
                        <CalendarActionIcon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-slate-200">{sub.name}</h3>
                        <p className="mt-0.5 text-xs text-muted">
                          {paid
                            ? t("finance.paidThisCycle")
                            : formatMovementDate(sub.next_billing_on as string)}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-sm font-bold text-slate-200">
                      {formatMoney(toNumber(sub.price))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className={deck.cardFooterRow}>
            <Link href="/dashboard/finance/" className={deck.cardFooterLink}>
              <span>{t("dashboard.viewInFinance")}</span>
              <span
                aria-hidden="true"
                className="transition-transform group-hover:translate-x-0.5"
              >
                →
              </span>
            </Link>
          </div>
        </div>
      )}
    </DeckCard>
  );
}
