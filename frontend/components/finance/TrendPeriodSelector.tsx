"use client";

import { t, type EsKey } from "@/lib/i18n";
import { TREND_PERIODS, type TrendPeriod } from "@/lib/finance/finance";

// Same pill treatment as `PeriodSelector` (border hull + has-checked signal),
// with a ≥44px hit area for the 4 bucket periods in both selectors.
const pillClass =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-full border border-hull px-3 py-1.5 text-xs text-instrument transition-colors hover:border-signal hover:text-signal focus-within:border-signal has-checked:border-signal has-checked:text-signal";

const TREND_LABEL_KEYS: Record<TrendPeriod, EsKey> = {
  day: "finance.trendPeriodDay",
  week: "finance.trendPeriodWeek",
  month: "finance.trendPeriodMonth",
  year: "finance.trendPeriodYear",
};

/** Día/Semana/Mes/Año radio-pills for the category line chart (bucket count,
 * not a date range). The parent owns the `month` default and the state. */
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
    <fieldset>
      <legend className="font-display text-sm font-medium">
        {label ?? t("finance.trendPeriodLabel")}
      </legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {TREND_PERIODS.map((period) => (
          <label key={period} className={pillClass}>
            <input
              type="radio"
              name={name}
              value={period}
              checked={value === period}
              onChange={() => onChange(period)}
              className="accent-current"
            />
            {t(TREND_LABEL_KEYS[period])}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
