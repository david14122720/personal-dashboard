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
 * The four KPI tiles of the Finanzas body (prototype `finanzas-desktop.html`
 * "KPIs / Telemetry Top Bar", mobile `finanzas-mobile.html` consolidated
 * balance card). Presentational only: every display string is already
 * localized and every figure comes from a real read the container owns (D10),
 * so a tile with nothing to show renders an honest note instead of a number.
 * The tile itself lives in `@/components/ui/KpiTile` (single primitive for
 * every surface).
 */

/** `ok` keeps the prototype's tone; the other states only change the footer. */
export type FinanceKpiTone = "ok" | "empty" | "loading" | "error";

export interface FinanceKpisProps {
  /** User currency code, shown next to the money values. */
  currency: string;
  balance: { display: string; footer: string; tone: FinanceKpiTone };
  accounts: { count: string; unit: string; footer: string };
  spend: { display: string; footer: string; tone: FinanceKpiTone };
  subscriptions: { display: string; footer: string; tone: FinanceKpiTone };
}

export default function FinanceKpis({
  currency,
  balance,
  accounts,
  spend,
  subscriptions,
}: FinanceKpisProps) {
  return (
    <section
      aria-label={t("finance.kpiSummaryLabel")}
      className="max-md:order-2 grid gap-gutter-desktop sm:grid-cols-2 lg:grid-cols-4"
    >
      <KpiTile
        label={t("finance.kpiBalance")}
        icon={<BalanceIcon className="h-3.5 w-3.5" />}
        signal
        glow="hairline"
        value={balance.display}
        valueClass={deck.kpiValue}
        unit={currency}
      >
        <p className={deck.kpiFooter}>
          <span className="line-clamp-2" title={balance.footer}>
            {balance.footer}
          </span>
        </p>
      </KpiTile>

      <KpiTile
        label={t("finance.kpiAccounts")}
        icon={<AccountsIcon className="h-3.5 w-3.5" />}
        value={accounts.count}
        valueClass={deck.kpiValue}
        unit={accounts.unit}
      >
        <p className={deck.kpiFooter}>
          <span className="line-clamp-2" title={accounts.footer}>
            {accounts.footer}
          </span>
        </p>
      </KpiTile>

      <KpiTile
        label={t("finance.kpiSpend")}
        icon={<SpendIcon className="h-3.5 w-3.5" />}
        value={spend.display}
        valueClass={deck.kpiValueSignal}
        unit={currency}
      >
        <p className={deck.kpiFooter} title={spend.footer}>
          {spend.tone === "ok" ? (
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
          ) : null}
          <span className="line-clamp-2">{spend.footer}</span>
        </p>
      </KpiTile>

      <KpiTile
        label={t("finance.kpiSubs")}
        icon={<SubscriptionsIcon className="h-3.5 w-3.5" />}
        value={subscriptions.display}
        valueClass={deck.kpiValue}
        unit={currency}
      >
        <p className={subscriptions.tone === "ok" ? deck.kpiFooterFlow : deck.kpiFooter}>
          {subscriptions.tone === "ok" ? (
            <span aria-hidden="true">✓</span>
          ) : null}
          <span className="line-clamp-2" title={subscriptions.footer}>
            {subscriptions.footer}
          </span>
        </p>
      </KpiTile>
    </section>
  );
}
