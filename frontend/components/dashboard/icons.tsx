/**
 * Inline SVG icon set for the Resumen surface (DESIGN-SPEC D3: the prototypes'
 * Material Symbols names are mapped to equivalent heroicon-style paths, never
 * to an icon-font dependency). Every icon is decorative: callers own the
 * accessible name of the element it decorates.
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

/** `credit_card`: KPI tile «Cuentas». */
export function AccountsIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect height="14" rx="2" width="20" x="2" y="5" />
      <path d="M2 10h20" />
    </Svg>
  );
}

/** `event_repeat`: KPI tile «Suscripciones». */
export function SubscriptionsIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </Svg>
  );
}

/** `savings`: KPI tile «Saldo Total». */
export function BalanceIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </Svg>
  );
}

/** `payments`: KPI tile «Gasto del Ciclo». */
export function SpendIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </Svg>
  );
}

/** `shopping_bag`: expense row. */
export function ExpenseRowIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
    </Svg>
  );
}

/** `bolt`: income row. */
export function IncomeRowIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M13 10V3L4 14h7v7l9-11h-7z" />
    </Svg>
  );
}

/** `swap_horiz`: transfer row. */
export function TransferRowIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4" />
    </Svg>
  );
}

/** `event_available`: dashed empty state of «Próximas suscripciones». */
export function CalendarActionIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect height="18" rx="2" ry="2" width="18" x="3" y="4" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </Svg>
  );
}

/** `verified`: dashed empty state of «Próximos pagos». */
export function VerifiedIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </Svg>
  );
}
