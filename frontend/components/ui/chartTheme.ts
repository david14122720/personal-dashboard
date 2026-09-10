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
