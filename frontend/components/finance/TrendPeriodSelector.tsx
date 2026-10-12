"use client";

import { t, type EsKey } from "@/lib/i18n";
import { TREND_PERIODS, type TrendPeriod } from "@/lib/finance/finance";
import { deck } from "@/components/ui/deckStyles";

const TREND_LABEL_KEYS: Record<TrendPeriod, EsKey> = {
  day: "finance.trendPeriodDay",
  week: "finance.trendPeriodWeek",
  month: "finance.trendPeriodMonth",
  year: "finance.trendPeriodYear",
};

/**
 * Single source for the Día/Semana/Mes/Año period control: the prototype's
 * segmented track (`finanzas-desktop.html`, `finanzas-mobile.html` chart card)
 * rendered through the `deckStyles` recipes. It keeps the native radio-group
 * semantics (`one input[name]` per period) and the accessible group name
 * (`Periodo`, overridable with `label`); the legend is visually hidden because
 * the prototype places the track inline. `DeckPeriodPills` (Resumen) delegates
 * here, so both surfaces share exactly one implementation.
 */
export default function TrendPeriodSelector({
  value,
  onChange,
  name = "trend-period",
  label,
}: {
  value: TrendPeriod;
  onChange: (period: TrendPeriod) => void;
  name?: string;
  label?: string;
}) {
  return (
    <fieldset className="flex justify-end">
      <legend className="sr-only">{label ?? t("finance.trendPeriodLabel")}</legend>
      <div className={deck.segmentedTrack}>
        {TREND_PERIODS.map((period) => (
          <label
            key={period}
            className={`relative ${
              value === period ? deck.segmentedActive : deck.segmentedInactive
            } inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center focus-within:ring-2 focus-within:ring-signal`}
          >
            <input
              type="radio"
              name={name}
              value={period}
              checked={value === period}
              onChange={() => onChange(period)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            {t(TREND_LABEL_KEYS[period])}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
