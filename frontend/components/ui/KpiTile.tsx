import { deck } from "@/components/ui/deckStyles";

/**
 * The single KPI tile primitive of the Control Deck surfaces (Resumen,
 * Finanzas, Productividad). It was extracted from the two identical local
 * copies in `DashboardKpis.tsx` and `FinanceKpis.tsx` so a new surface stops
 * growing its own tile; both call sites now render this component with the
 * exact same DOM (the `glow` variant keeps each surface faithful to its
 * prototype).
 *
 * Presentational only: the caller owns every string, so an unloaded or empty
 * surface renders an honest note instead of an invented number (D10).
 */

/** `corner` is the Resumen/Productividad glow; `hairline` adds the top accent
 * line of the Finanzas balance tile. */
export type KpiGlow = "corner" | "hairline";

export interface KpiTileProps {
  /** Mono micro-label above the value (rendered uppercase by `deck.kpiLabelRow`). */
  label: string;
  /** Decorative icon inside the label row chip. */
  icon: React.ReactNode;
  /** Renders the accent (sky) icon chip instead of the neutral one. */
  signal?: boolean;
  /** Accent glow behind the card; omit for a flat tile. */
  glow?: KpiGlow;
  value: string;
  /** Value class from `deck` (`kpiValue` / `kpiValueSignal`). */
  valueClass: string;
  /** Unit/baseline note rendered after the value. */
  unit?: string;
  /** Optional suffix rendered inside the value baseline (delta chip, chips). */
  valueSuffix?: React.ReactNode;
  /** Bar, chips and footer notes go below the value. */
  children?: React.ReactNode;
}

export default function KpiTile({
  label,
  icon,
  signal,
  glow,
  value,
  valueClass,
  unit,
  valueSuffix,
  children,
}: KpiTileProps) {
  return (
    <article className={`${deck.kpiTile} relative overflow-hidden`}>
      {glow === "corner" ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-4 -right-4 h-20 w-20 rounded-full bg-sky-500/5 blur-xl"
        />
      ) : null}
      {glow === "hairline" ? (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-sky-400 via-sky-500 to-transparent"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-6 -right-6 h-24 w-24 rounded-full bg-sky-500/5 blur-2xl"
          />
        </>
      ) : null}
      <div className={deck.kpiLabelRow}>
        <span>{label}</span>
        <span className={signal ? deck.kpiIconChipSignal : deck.kpiIconChip}>{icon}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={valueClass}>{value}</span>
        {unit ? <span className="text-xs font-medium text-slate-400">{unit}</span> : null}
        {valueSuffix}
      </div>
      {children}
    </article>
  );
}
