import { chartToken } from "@/lib/i18n";

/** Token-driven color helper shared by all S6 charts (cero hex, var() fallback). */
export function chartTok(prop: `--color-${string}`): string {
  return chartToken(prop) || `var(${prop})`;
}

/** Shared Recharts tooltip style. D8: the tooltip floats over a card, so it
 * uses the card surface and the hairline border instead of the old hull pair. */
export function chartTooltipStyle(): {
  backgroundColor: string;
  border: string;
  borderRadius: number;
  color: string;
  fontSize: number;
} {
  return {
    backgroundColor: chartTok("--color-card"),
    border: `1px solid ${chartTok("--color-hair")}`,
    borderRadius: 8,
    color: chartTok("--color-instrument"),
    fontSize: 12,
  };
}

/** Shared axis tick style (instrument, 12px). */
export function chartTick(): { fill: string; fontSize: number } {
  return { fill: chartTok("--color-instrument"), fontSize: 12 };
}

/**
 * Control Deck chart frame (D8), applied to the wrapper of a Recharts plot.
 *
 * The shared `CategoryTrendChart` keeps its own markup (it also serves
 * Finanzas), so the frame is expressed as child-selector utilities that
 * Tailwind compiles into descendant rules over the SVG Recharts draws:
 * horizontal hairline grid only, no vertical grid, no axis lines, no built-in
 * legend (the Resumen cards render the prototype's legend row with the real
 * totals instead), and the prototype's sky glow on the first (primary) series.
 * Nothing here is a number: every value still comes from the real data range.
 */
export const chartDeckFrameClass = [
  "[&_.recharts-cartesian-grid-horizontal_line]:stroke-hair",
  "[&_.recharts-cartesian-grid-vertical]:hidden",
  "[&_.recharts-cartesian-axis-line]:hidden",
  "[&_.recharts-legend-wrapper]:hidden",
  "[&_.recharts-line:first-of-type_.recharts-line-curve]:drop-shadow-[0_0_8px_rgba(56,189,248,0.5)]",
].join(" ");

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
