import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/api/money";
import type { AccountCardView } from "@/lib/finance/finance";

/** Detalle solo-formato (límite/disponible/alerta del BE); el cambio de límite es DELETE+recreate. */
export function CardDetail({ card, locale }: { card: AccountCardView; locale: string }) {
  const limit = (card.used ?? 0) + (card.available ?? 0);
  return (
    <div aria-label={card.name} className="rounded-lg border border-hull px-4 py-3">
      <p className="text-sm font-medium">{card.name}</p>
      <p className="mt-1 font-mono text-sm tabular-nums">
        {t("finance.cardLimitDetail", { limit: formatMoney(limit, { locale, currency: card.currency }), available: formatMoney(card.available ?? 0, { locale, currency: card.currency }) })}
      </p>
      {card.alertLevel ? (<p className="mt-1 text-xs text-instrument/60">{t("finance.cardAlert", { level: card.alertLevel })}</p>) : null}
      <p className="mt-2 text-xs text-instrument/60">{t("finance.limitChangeHint")}</p>
    </div>
  );
}

export default CardDetail;
