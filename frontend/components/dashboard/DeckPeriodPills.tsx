"use client";

import TrendPeriodSelector from "@/components/finance/TrendPeriodSelector";
import type { TrendPeriod } from "@/lib/finance/finance";

/**
 * Resumen-sized alias of the shared period control. T3 introduced this file
 * because `TrendPeriodSelector` was outside its edit surfaces; the recipe now
 * lives in the shared selector (single implementation), and this component
 * only forwards props so the Resumen disclosures keep their `name`,
 * `aria-controls` and state contract untouched.
 */
export default function DeckPeriodPills({
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
    <TrendPeriodSelector value={value} onChange={onChange} name={name} label={label} />
  );
}
