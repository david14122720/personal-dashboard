"use client";
import Link from "next/link";
import { useSWRConfig } from "swr";
import DeckCard, { DeckEmptyState } from "@/components/dashboard/DeckCard";
import { SectionError, SectionSkeleton } from "@/components/dashboard/SectionStates";
import { VerifiedIcon } from "@/components/dashboard/icons";
import { deck } from "@/components/ui/deckStyles";
import { useEvents, useSubscriptions } from "@/lib/api/dashboard";
import { toUpcomingPayments } from "@/lib/dashboard/transforms";
import { t } from "@/lib/i18n";

/**
 * «Próximos pagos»: subscriptions and payment-due events inside the 7-day
 * window, in the prototype card chrome with the real `Ocultar bloque` control
 * in its header, its dashed empty state and the footer link.
 */
export default function UpcomingPayments({
  action,
  className,
}: {
  /** Real visibility control owned by the container (WidgetToggle). */
  action?: React.ReactNode;
  className?: string;
} = {}) {
  const subs = useSubscriptions();
  const events = useEvents(null, null);
  const { mutate } = useSWRConfig();
  const items = toUpcomingPayments(subs.data, events.data).slice(0, 7);

  return (
    <DeckCard
      title={t("dashboard.upcomingPayments")}
      hint={t("dashboard.upcomingPaymentsHint")}
      className={className}
      action={action}
    >
      {subs.isLoading || events.isLoading ? (
        <SectionSkeleton label={t("common.loading")} />
      ) : subs.error || events.error ? (
        <SectionError
          message={t("dashboard.loadFailed")}
          onRetry={() =>
            void mutate((key) => typeof key === "string" && key.startsWith("dashboard/"))
          }
        />
      ) : (
        <div className="animate-fade-in motion-reduce:animate-none">
          {items.length === 0 ? (
            <DeckEmptyState
              icon={<VerifiedIcon className="h-5 w-5 text-emerald-400" />}
              title={t("dashboard.upcomingPaymentsEmpty")}
              hint={t("dashboard.upcomingPaymentsEmptyHint")}
            />
          ) : (
            <ul className="flex flex-col gap-2.5">
              {items.map((item) => (
                <li key={item.id} className={deck.listRow}>
                  <div className="flex items-start gap-3 sm:items-center">
                    <span
                      className={`${deck.rowIconTile} border-emerald-500/20 bg-emerald-500/10 text-emerald-400`}
                    >
                      <VerifiedIcon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 truncate text-sm font-semibold text-slate-200">
                      {item.title}
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-slate-400">
                    {item.due}
                  </span>
                </li>
              ))}
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
