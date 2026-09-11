/**
 * Visual area-score boundary. Pure helper next to `habitStats.ts` — inputs
 * arrive already normalized 0–100 by their own transforms (money coerced at
 * the dashboard boundary, never here). Output is presentational only:
 * bars/LEDs per area, never a single "grade" (no `overall`/`total` key).
 *
 * Reference weights (documentation only, no aggregation is computed):
 * finanzas 30 / hábitos 30 / metas 20 / productividad 20.
 * `null`/`undefined`/`NaN` means "no data" → neutral empty visual, the
 * component renders "Sin datos" instead of any fabricated number.
 */

export type AreaKey = "finance" | "habits" | "goals" | "productivity";

export type AreaScoreInput = Partial<Record<AreaKey, number | null | undefined>>;

export interface AreaScore {
  area: AreaKey;
  /** Normalized 0–100 (1 decimal), or `null` when the area has no data. */
  value: number | null;
  hasData: boolean;
  /** Reference weight 0–100, documentation only (no composite is computed). */
  weight: number;
}

const AREAS: Array<{ area: AreaKey; weight: number }> = [
  { area: "finance", weight: 30 },
  { area: "habits", weight: 30 },
  { area: "goals", weight: 20 },
  { area: "productivity", weight: 20 },
];

function normalize(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(Math.min(100, Math.max(0, value as number)) * 10) / 10;
}

/** One visual indicator per area, in stable area order. Never invents data. */
export function scoreByArea(input: AreaScoreInput): AreaScore[] {
  return AREAS.map(({ area, weight }) => {
    const value = normalize(input[area]);
    return { area, value, hasData: value !== null, weight };
  });
}
