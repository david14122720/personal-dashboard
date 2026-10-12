import { deck } from "@/components/ui/deckStyles";
import KpiTile from "@/components/ui/KpiTile";
import {
  AccountsIcon,
  BalanceIcon,
  SpendIcon,
  SubscriptionsIcon,
} from "@/components/dashboard/icons";
import { t } from "@/lib/i18n";

/**
 * The four KPI tiles of the Resumen body (prototype `dashboard-desktop.html`
 * KpiMetricsGrid). Presentational only: every display string is already
 * localized and every count comes from a real read the container owns (D10).
 * The grid is 2x2 on phones (prototype `dashboard-mobile.html`) and 4-up from
 * `lg`, and never renders an invented month-over-month figure. The tile itself
 * lives in `@/components/ui/KpiTile` (single primitive for every surface).
 */

export interface DashboardKpisProps {
  accounts: { count: string; unit: string; footer: string };
  subscriptions: { display: string; currency: string; footer: string };
  balance: { display: string; footer: string };
  cycleSpend: {
    display: string;
    currency: string;
    footer: string;
    /** `ok` renders the sky dot of the prototype with the real chips; the
     * other tones render the honest note alone (empty / loading / error). */
    tone: "ok" | "empty" | "loading" | "error";
  };
}

export default function DashboardKpis({
  accounts,
  subscriptions,
  balance,
  cycleSpend,
}: DashboardKpisProps) {
  return (
    <section
      aria-label={t("dashboard.kpiSummaryLabel")}
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
    >
      <KpiTile
        label={t("finance.accounts")}
        icon={<AccountsIcon className="h-3.5 w-3.5" />}
        value={accounts.count}
        valueClass={deck.kpiValue}
        unit={accounts.unit}
      >
        <p className={deck.kpiFooter}>
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
          <span className="line-clamp-2" title={accounts.footer}>
            {accounts.footer}
          </span>
        </p>
      </KpiTile>

      <KpiTile
        label={t("finance.subscriptions")}
        icon={<SubscriptionsIcon className="h-3.5 w-3.5" />}
        value={subscriptions.display}
        valueClass={deck.kpiValue}
        unit={subscriptions.currency}
      >
        <p className={deck.kpiFooterFlow}>
          <span aria-hidden="true">✓</span>
          <span className="line-clamp-2" title={subscriptions.footer}>
            {subscriptions.footer}
          </span>
        </p>
      </KpiTile>

      <KpiTile
        label={t("dashboard.totalBalance")}
        icon={<BalanceIcon className="h-3.5 w-3.5" />}
        signal
        glow="corner"
        value={balance.display}
        valueClass={deck.kpiValue}
      >
        <p className={deck.kpiFooter}>
          <span className="line-clamp-2" title={balance.footer}>
            {balance.footer}
          </span>
        </p>
      </KpiTile>

      <KpiTile
        label={t("dashboard.kpiCycleSpend")}
        icon={<SpendIcon className="h-3.5 w-3.5" />}
        value={cycleSpend.display}
        valueClass={deck.kpiValueSignal}
        unit={cycleSpend.currency}
      >
        <p className={deck.kpiFooter} title={cycleSpend.footer}>
          {cycleSpend.tone === "ok" ? (
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
          ) : null}
          <span className="line-clamp-2">{cycleSpend.footer}</span>
        </p>
      </KpiTile>
    </section>
  );
}
