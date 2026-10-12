/**
 * Inline SVG glyphs specific to the Finanzas body (DESIGN-SPEC D3: the
 * prototype's Material Symbols names are mapped to heroicon-style paths, never
 * to an icon-font dependency). The Resumen glyphs that already exist stay in
 * `components/dashboard/icons.tsx` and are imported from there. Every icon is
 * decorative: callers own the accessible name of the element it decorates.
 */

interface IconProps {
  className?: string;
}

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

/** `sync_alt`: toolbar/quick action «Mover dinero». */
export function TransferActionIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4" />
    </Svg>
  );
}

/** `tune`: toolbar/quick action «Conciliar saldo». */
export function TuneIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </Svg>
  );
}

/** `payments`: toolbar/quick action «+ Agregar gasto». */
export function PaymentsIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </Svg>
  );
}

/** `add_circle`: toolbar/quick action «+ Agregar ingreso». */
export function AddCircleIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 8v8m-4-4h8m9 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </Svg>
  );
}

/** `refresh`: «Actualizar saldos» in the Cuentas card header. */
export function RefreshIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 4v6h6M20 20v-6h-6" />
      <path d="M20 10a8 8 0 00-14.9-3M4 14a8 8 0 0014.9 3" />
    </Svg>
  );
}

/** `add`: «Nueva cuenta» affordance. */
export function PlusIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

/** `arrow_forward`: quick-access card affordance. */
export function ArrowRightIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 12h14m0 0l-6-6m6 6l-6 6" />
    </Svg>
  );
}

/** `query_stats`: chart-card compare affordance. */
export function QueryStatsIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 3v18h18M8 16l3-4 3 2 5-7" />
    </Svg>
  );
}

/** `account_balance_wallet`: «Cuentas & Billeteras» / quick-access «Suscripciones». */
export function WalletIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 7a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm14 4h4v4h-4a2 2 0 010-4z" />
    </Svg>
  );
}

/** `edit`: movement row edit affordance. */
export function PencilIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M11 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-5" />
      <path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </Svg>
  );
}

/** `delete`: movement row delete affordance. */
export function TrashIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
    </Svg>
  );
}
