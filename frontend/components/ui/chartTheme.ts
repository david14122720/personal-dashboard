import { chartToken } from "@/lib/i18n";

/** Token-driven color helper shared by all S6 charts (cero hex, var() fallback). */
export function chartTok(prop: `--color-${string}`): string {
  return chartToken(prop) || `var(${prop})`;
}

/** Shared Recharts tooltip style (hull bg, instrument text, 12px). */
export function chartTooltipStyle(): {
  backgroundColor: string;
  border: string;
  borderRadius: number;
  color: string;
  fontSize: number;
} {
  return {
    backgroundColor: chartTok("--color-hull"),
    border: `1px solid ${chartTok("--color-hull")}`,
    borderRadius: 8,
    color: chartTok("--color-instrument"),
    fontSize: 12,
  };
}

/** Shared axis tick style (instrument, 12px). */
export function chartTick(): { fill: string; fontSize: number } {
  return { fill: chartTok("--color-instrument"), fontSize: 12 };
}

/** Multi-series palette for habit evolution/compare (max 4, token-driven, no hex). */
export const EVOLUTION_SERIES_TOKENS = ["--color-flow", "--color-signal", "--color-alert", "--color-violet"] as const;

/** Category pie palette (token-driven, no hex). Deterministic order so the
 * legend is stable; cycles when a period has more categories than tokens. */
export const CATEGORY_PIE_TOKENS = [
  "--color-signal",
  "--color-flow",
  "--color-warn",
  "--color-violet",
  "--color-alert",
  "--color-signal-soft",
] as const;

/** Token for pie slice `index`, cycling through `CATEGORY_PIE_TOKENS`. */
export function categoryPieToken(index: number): `--color-${string}` {
  return CATEGORY_PIE_TOKENS[index % CATEGORY_PIE_TOKENS.length];
}
