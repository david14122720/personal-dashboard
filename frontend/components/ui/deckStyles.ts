/**
 * Control Deck design language — single source of truth for the shared recipes.
 *
 * Ported verbatim from the Stitch prototypes in
 * `odd/design/stitch-control-deck/html/` (canonical: `dashboard-desktop.html`;
 * the mobile list row comes from `dashboard-mobile.html`). Only the token names
 * changed, so the class strings resolve against `app/globals.css`:
 *
 *   bg-deck-surface        -> bg-panel            (--color-panel)
 *   bg-deck-card           -> bg-card             (--color-card)
 *   bg-deck-bg             -> bg-deck             (--color-deck)
 *   border-deck-border      -> border-hair         (--color-hair)
 *   border-deck-borderLight -> border-hair-strong  (--color-hair-strong)
 *   text-deck-white        -> text-instrument     (--color-instrument)
 *   text-deck-muted        -> text-muted          (--color-muted)
 *   text-deck-bg           -> text-deck           (--color-deck)
 *
 * Mobile Material-3 names reuse the repo tokens that already hold the
 * prototype's exact values (`surface-container` -> `bg-container`,
 * `surface-container-high` -> `bg-container-high`), so no second mobile
 * surface color is introduced (DESIGN-SPEC D7).
 *
 * Tailwind palette classes (`bg-sky-500/*`, `text-slate-*`, ...) are kept as-is.
 * Two prototype defects are fixed on copy (DESIGN-SPEC "Pitfalls" 1 and 2):
 * `py-0.2` -> `py-[0.1rem]` and a size class on `shadow-sky-500/30`.
 */

export const deck = {
  /** Card shell: every panel in the deck (`bg-deck-card ... rounded-xl p-5`). */
  panel: "bg-card border border-hair rounded-xl p-5 shadow-sm",
  /** KPI tile: card shell with the lighter hover hairline. */
  kpiTile:
    "bg-card border border-hair hover:border-hair-strong p-4 rounded-xl transition-all shadow-sm",
  /** Count pill: neutral "3 pendientes" / "2 registros" badge. */
  countPill: "text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400",
  /** Notification count badge in the "Avisos" button (defect 1 fixed on copy). */
  notificationCountPill:
    "px-1.5 py-[0.1rem] rounded-full text-[10px] bg-amber-500/10 text-amber-300 font-mono font-bold border border-amber-500/30",
  /** Mono micro-label above a KPI value. */
  monoMicroLabel: "text-xs text-muted mb-2 font-mono uppercase tracking-wider",
  /** Primary CTA ("Registrar actividad"; defect 2 fixed on copy). */
  primaryCta:
    "flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold transition-all glow-cyan-btn shadow-lg shadow-sky-500/30",
  /** Ghost/secondary button on a panel surface ("Avisos"). */
  ghostButton:
    "relative flex min-h-11 items-center gap-2 px-3 py-1.5 rounded-lg bg-panel hover:bg-card border border-hair text-xs font-medium text-slate-300 transition-colors",
  /** Segmented control track (period filters Día/Semana/Mes/Año). */
  segmentedTrack: "flex items-center bg-panel border border-hair p-1 rounded-lg",
  /** Selected segment inside `segmentedTrack`. */
  segmentedActive:
    "px-2.5 py-1 text-xs font-semibold rounded bg-sky-500/15 text-sky-400 border border-sky-500/30",
  /** Unselected segment inside `segmentedTrack`. */
  segmentedInactive:
    "px-2.5 py-1 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors",
  /** Desktop list row (movements / habits inside a card). */
  listRow:
    "flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg bg-panel border border-hair hover:border-slate-700 transition-colors",
  /** Mobile list row (`dashboard-mobile.html`), touch-first with active state. */
  listRowMobile:
    "p-3 rounded-lg bg-container flex items-center justify-between gap-2 active:bg-container-high transition-colors",
  /** Section header row inside a card, above the body. */
  sectionHeader: "flex items-center justify-between pb-3 border-b border-hair",
  /** Same header row, but it wraps below `sm` (chart cards with a control). */
  sectionHeaderWrap:
    "flex flex-col gap-3 pb-3 border-b border-hair sm:flex-row sm:items-center sm:justify-between",
  /** Card title inside a header row. */
  sectionTitle: "text-base font-semibold text-instrument",
  /** Card subtitle under the title. */
  sectionSubtitle: "mt-0.5 text-xs text-muted",
  /** "Ver en Finanzas" anchor in a card footer (min 44px hit area). */
  cardFooterLink:
    "inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-sky-400 hover:text-sky-300 transition-colors group",
  /** Footer row that holds a `cardFooterLink`. */
  cardFooterRow: "mt-4 flex justify-end border-t border-hair pt-3",
  /** Dashed empty-state frame (honest omission when a card has no data). */
  emptyState:
    "mt-4 p-8 rounded-xl border border-dashed border-hair bg-panel/40 flex flex-col items-center justify-center text-center",
  /** Icon ball on top of a card empty state. */
  emptyIconBall:
    "mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-slate-700/80 bg-slate-800/80 text-slate-400",
  /** Empty-state title. */
  emptyTitle: "text-sm font-semibold text-slate-200",
  /** Empty-state hint. */
  emptyHint: "mt-1 max-w-xs text-xs text-slate-500",
  /** KPI label row: mono micro-label on the left, icon chip on the right. */
  kpiLabelRow:
    "flex items-center justify-between text-xs text-muted mb-2 font-mono uppercase tracking-wider",
  /** Neutral icon chip in a KPI tile. */
  kpiIconChip: "p-1.5 rounded-md bg-slate-800 text-slate-400",
  /** Signal (sky) icon chip in the KPI tile that carries the accent color. */
  kpiIconChipSignal: "p-1.5 rounded-md bg-sky-500/10 text-sky-400 border border-sky-500/20",
  /** KPI value line: the mobile prototype renders the 20px headline-md scale
   * inside the 2x2 phone grid, the desktop prototype the 24px one. */
  kpiValue: "text-xl font-bold font-mono tracking-tight text-instrument sm:text-2xl",
  /** KPI value in the signal color (currency, matching the icon chip). */
  kpiValueSignal: "text-xl font-bold font-mono tracking-tight text-sky-400 sm:text-2xl",
  /** KPI value in the flow color (completed-today tile). */
  kpiValueFlow: "text-xl font-bold font-mono tracking-tight text-flow-soft sm:text-2xl",
  /** KPI footer note. */
  kpiFooter: "mt-2 text-[11px] text-slate-500 flex items-center gap-1.5",
  /** KPI footer note in the flow color (no pending charges). */
  kpiFooterFlow: "mt-2 text-[11px] text-emerald-400/90 flex items-center gap-1.5",
  /** Chart legend row under the plot. */
  chartLegendRow:
    "mt-4 flex items-center justify-center gap-6 border-t border-hair pt-3 text-xs",
  /** Glowing swatch of the primary series in a legend row. */
  legendSwatchGlow: "w-3 h-1.5 rounded-full bg-sky-400 shadow-[0_0_8px_#38bdf8]",
  /** Swatch of the secondary series in a legend row. */
  legendSwatchFlow: "w-3 h-1.5 rounded-full bg-emerald-400",
  /** List-row icon tile (movements); the direction color is added by the row. */
  rowIconTile: "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
  /** Small category chip inside a list row. */
  rowChip: "rounded border border-hair bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-300",
  /** Habit streak pill; the heat variant is added by the row. */
  streakPill: "flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-xs",
  /** No streak yet. */
  streakPillCold: "bg-slate-800/80 text-slate-400 border-slate-700/60",
  /** Short streak (1-2 days). */
  streakPillWarm: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  /** Long streak (3+ days). */
  streakPillHot: "bg-sky-500/10 text-sky-300 border-sky-500/30",

  /* -- Finanzas (finanzas-desktop.html / finanzas-mobile.html) ------------
   * The toolbar/quick bar is ONE control list: the mobile prototype stacks
   * icon-over-label in a 4-column grid, the desktop prototype lays the same
   * actions inline in the header, so the recipes below switch layout at `sm`
   * instead of duplicating the buttons (same accessible name at every width). */

  /** Page title row (h1 + currency chip + status pill). */
  pageTitle: "text-headline-xl-mobile font-bold tracking-tight text-instrument sm:text-headline-xl",
  /** Currency chip next to the page title (`bg-primary-container/15`). */
  currencyChip:
    "rounded-full bg-sky-500/15 px-2.5 py-0.5 font-mono text-[11px] font-bold tracking-widest text-sky-300",
  /* The toolbar/quick-bar actions below are stacked (icon over label, the
   * phone quick bar) and become inline rows from `lg`, when the header really
   * is one row: one control list, one accessible name per operation. */
  /** Neutral toolbar action (`Mover dinero`, `Conciliar saldo`). */
  toolbarActionNeutral: "inline-flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg border border-hair bg-card px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-instrument transition-colors hover:border-hair-strong hover:bg-card-hover lg:w-auto lg:flex-row lg:gap-2 lg:px-3.5 lg:text-xs lg:normal-case lg:tracking-normal",
  /** Signal toolbar action (the expense CTA). */
  toolbarActionSignal:
    "inline-flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-sky-300 transition-colors hover:bg-sky-500/25 glow-cyan-sm lg:w-auto lg:flex-row lg:gap-2 lg:px-3.5 lg:text-xs lg:normal-case lg:tracking-normal",
  /** Flow toolbar action (the income CTA). */
  toolbarActionFlow:
    "inline-flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-400 transition-colors hover:bg-emerald-500/20 lg:w-auto lg:flex-row lg:gap-2 lg:px-3.5 lg:text-xs lg:normal-case lg:tracking-normal",
  /** Small square icon control in a card header (refresh balances, ≥44px). */
  headerIconButton:
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-hair bg-panel text-slate-400 transition-colors hover:border-hair-strong hover:text-signal",
  /** Account tile (`finanzas-desktop.html` grid matrix cell). */
  accountTile:
    "flex h-full flex-col justify-between gap-3 rounded-xl border border-hair bg-card p-3.5 shadow-sm transition-colors hover:border-hair-strong",
  /** Initials avatar of an account tile (never an icon: the wire has no type). */
  accountAvatar:
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 font-mono text-[11px] font-bold tracking-tight text-sky-300",
  /** Account tile caption line (`text-label-caps text-outline uppercase`). */
  accountCaption: "text-[11px] uppercase tracking-wider text-faint",
  /** Inline tile action base (`Mover` / `Editar saldo`), ≥44px (mobile rule). */
  tileAction:
    "inline-flex min-h-11 min-w-11 items-center justify-center px-1 text-[11px] font-semibold uppercase tracking-wider transition-colors",
  /** Signal inline tile action. */
  tileActionSignal: "inline-flex min-h-11 min-w-11 items-center justify-center px-1 text-[11px] font-semibold uppercase tracking-wider text-sky-400 transition-colors hover:text-sky-300",
  /** Neutral inline tile action. */
  tileActionNeutral: "inline-flex min-h-11 min-w-11 items-center justify-center px-1 text-[11px] font-semibold uppercase tracking-wider text-faint transition-colors hover:text-instrument",
  /** Movements filter tray (`bg-surface-container-lowest/60` in the prototype). */
  filterTray: "grid grid-cols-1 gap-2.5 rounded-xl border border-hair bg-deck/60 p-2.5 sm:grid-cols-3",
  /** Mono micro-label of one filter (`Cuenta` / `Categoría` / `Tipo`). */
  filterLabel: "px-1 text-[11px] font-bold uppercase tracking-wider text-faint",
  /** Filter field inside the tray (prototype surface-container select). */
  filterField:
    "mt-1 min-h-11 w-full cursor-pointer appearance-none rounded-lg border border-hair bg-card px-3 py-2 text-xs text-instrument transition-colors focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/30",
  /** Round direction chips (mobile prototype); they carry the ≥44px area the
   * prototype's 28px chip does not have, because they are real controls. */
  /** Active round chip. */
  filterChipActive: "inline-flex min-h-11 items-center justify-center rounded-full border border-sky-500/40 bg-sky-500/15 px-3 text-xs font-semibold text-sky-300 transition-colors",
  /** Idle round chip. */
  filterChipIdle:
    "inline-flex min-h-11 items-center justify-center rounded-full border border-hair bg-card px-3 text-xs font-semibold text-slate-400 transition-colors hover:text-instrument",
  /** Movement row, transfer variant (its own recipe so no border color is
   * overridden: `border-hair` and `border-signal/50` never coexist). */
  listRowTransfer:
    "flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-signal/50 bg-signal/5 transition-colors",
  /** Real date range label above the category chart (`text-label-caps`). */
  chartRangeLabel: "text-[11px] font-mono uppercase tracking-wider text-faint",
  /** "Accesos rápidos" link card (whole card is the anchor). */
  quickCard:
    "group flex flex-col justify-between gap-3 rounded-xl border border-hair bg-panel p-4 shadow-sm transition-colors hover:border-hair-strong hover:bg-card",
  /** Icon tile of a quick-access card. */
  quickCardIcon:
    "flex h-9 w-9 items-center justify-center rounded-lg border border-hair bg-card text-sky-400",
  /** Title line of a quick-access card. */
  quickCardTitle: "block text-sm font-semibold text-instrument",
  /** Copy line of a quick-access card. */
  quickCardCopy: "mt-0.5 line-clamp-2 text-xs text-muted",

  /* -- Productividad (productividad-desktop-v2.html) -----------------------
   * Module header chips, the collapsible calendar and the KPI row. Every
   * number these recipes decorate is computed from the live reads (D10), so a
   * chip only exists while the state it names is real. */

  /** Module header chip: `MODO ENFOQUE` (a label for the surface, not a state). */
  focusChip:
    "inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.25)]",
  /** Pulsing dot of `focusChip` (reduced-motion safe). */
  focusChipDot: "h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-sky-400 motion-reduce:animate-none",
  /** Sync chip. Rendered only once every page read resolved without error. */
  syncChip:
    "inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-emerald-400",
  /** Sync chip while the page reads are still in flight (never claims sync). */
  syncChipPending:
    "inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-amber-300",
  /** Neutral header action (`Ver calendario expandido`, `+ Meta`, `+ Evento`...). */
  headerAction:
    "inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-hair bg-card px-3 text-xs font-semibold text-instrument transition-colors hover:border-hair-strong hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal",
  /** Signal header action (`+ Nueva tarea`, the prototype's CTA). */
  headerActionSignal:
    "inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3.5 text-xs font-semibold text-sky-300 transition-colors hover:bg-sky-500/25 glow-cyan-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal",
  /** KPI progress track (prototype `bg-surface-container-highest`). */
  kpiProgressTrack: "mt-3 h-1.5 w-full overflow-hidden rounded-full bg-deck",
  /** Signal fill of `kpiProgressTrack` (tasa de cumplimiento). */
  kpiProgressFillSignal:
    "h-full rounded-full bg-gradient-to-r from-signal-deep to-signal shadow-[0_0_8px_rgba(56,189,248,0.5)]",
  /** Flow fill of `kpiProgressTrack` (metas). */
  kpiProgressFillFlow: "h-full rounded-full bg-flow shadow-[0_0_8px_rgba(82,232,124,0.5)]",
  /** Alert-tone KPI chip (`N urgentes`). */
  kpiChipAlert:
    "rounded-full bg-alert/15 px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-alert-soft",
  /** Neutral KPI chip (`N en curso`). */
  kpiChipNeutral:
    "rounded-full bg-card-hover px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-muted",
  /** Positive delta chip on the value baseline (`+50 pts`). */
  kpiDeltaUp: "font-mono text-[11px] font-bold text-emerald-400",
  /** Negative delta chip on the value baseline. */
  kpiDeltaDown: "font-mono text-[11px] font-bold text-alert-soft",
  /** Calendar card shell (the collapsible block). */
  calendarPanel: "rounded-xl border border-hair bg-card p-4 shadow-sm sm:p-5",
  /** Calendar header row (title block + legend + month controls). */
  calendarHeader: "flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between",
  /** Icon tile of the calendar title block. */
  calendarIconTile: "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-card-hover text-signal",
  /** `<Mes> <Año>` title of the calendar. */
  calendarTitle: "font-display text-lg font-semibold tracking-tight text-instrument",
  /** `Semana N · Telemetría semanal` subline of the calendar title block. */
  calendarTelemetry: "font-mono text-[11px] uppercase tracking-[0.08em] text-faint",
  /** Legend row of the real calendar series. */
  calendarLegend:
    "flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-[0.08em] text-muted",
  /** Square legend dot: Tareas. */
  calendarLegendDotTask: "h-2 w-2 shrink-0 rounded-sm bg-signal",
  /** Round legend dot: Eventos. */
  calendarLegendDotEvent: "h-2 w-2 shrink-0 rounded-full bg-signal-deep",
  /** Month control group (`chevron_left` / `Hoy` / `chevron_right`). */
  calendarNavGroup: "flex items-center gap-1 rounded-lg border border-hair bg-card p-1",
  /** Month control; keeps the 44px thumb target of the calendar. */
  calendarNavButton:
    "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-2 text-sm text-muted transition-colors hover:bg-card-hover hover:text-instrument focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal",
  /** Day cell: 44px thumb target that grows to the prototype's 72px cell
   * from `sm` (below that width a real 72px cell would not hold at 390px). */
  calendarCell:
    "flex min-h-[44px] min-w-0 flex-col items-center justify-between gap-0.5 rounded-lg border px-1 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:min-h-[72px]",
  /** Today's cell (prototype `bg-surface-container-high/90` + cyan glow). */
  calendarCellToday: "border-signal/50 bg-card-hover shadow-[0_0_16px_rgba(56,189,248,0.18)]",
  /** Marker row inside a day cell. */
  calendarCellMarkers: "flex flex-wrap items-center justify-center gap-1 leading-none",
  /** Real-dot marker of a day (the shape is the non-colour cue). */
  calendarMarker: "inline-flex items-center gap-0.5",
  /** Marker count next to the dot. */
  calendarMarkerCount: "font-mono text-[11px] tabular-nums",

  /* -- Productividad content cards (productividad-desktop-v2.html) ---------
   * The Metas / Eventos y Agenda / Tareas / Notas y Bitácora rows. One recipe
   * per repeated piece so the four cards share the same language, and every
   * row action keeps the 44px thumb target of the calendar controls. */

  /** Row card inside a content section (`p-space-md rounded-xl` prototype row). */
  cardRow:
    "rounded-xl border border-hair bg-panel/50 p-3.5 transition-colors hover:border-hair-strong hover:bg-card-hover",
  /** Colour dot of a goal row: the real goal colour when the wire carries one. */
  goalDot: "h-2.5 w-2.5 shrink-0 rounded-full",
  /** Mono percentage on the right of a goal row (prototype `metric-val`). */
  cardMetric: "shrink-0 font-mono text-lg font-bold tracking-tight text-signal",
  /** Goal progress track (prototype `h-2 bg-surface-container-highest`). */
  cardProgressTrack: "h-2 w-full overflow-hidden rounded-full bg-deck",
  /** Content-card section action (`Nueva` / `Nuevo`), one recipe for both. */
  cardAction:
    "inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-hair bg-card-hover px-3 font-display text-xs font-semibold text-instrument transition-colors hover:border-hair-strong hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal",
  /** Filter pill of the content cards, idle (`TODAS (n)` prototype chip). */
  cardPillIdle:
    "inline-flex min-h-11 items-center justify-center rounded-full border border-hair bg-card-hover px-3 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-muted transition-colors hover:border-hair-strong hover:text-instrument focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal",
  /** Filter pill of the content cards, selected. */
  cardPillActive:
    "inline-flex min-h-11 items-center justify-center rounded-full border border-signal/40 bg-signal/15 px-3 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-signal shadow-[0_0_10px_rgba(56,189,248,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal",
  /** Inline text action of a content-card row footer (≥44px). */
  cardTextAction:
    "inline-flex min-h-11 items-center rounded-lg px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted transition-colors hover:bg-card-hover hover:text-instrument focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal",
  /** Signal inline text action (the app's real primary row action). */
  cardTextActionSignal:
    "inline-flex min-h-11 items-center rounded-lg px-2.5 text-[11px] font-semibold uppercase tracking-wider text-signal transition-colors hover:bg-signal/10 hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal",
  /** Event date block (`OCT` over the day). */
  dateBlock:
    "flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg border border-hair bg-card-hover text-signal",
  /** Month caption of `dateBlock`. */
  dateBlockMonth: "font-mono text-[10px] font-bold uppercase leading-none tracking-wider",
  /** Day inside `dateBlock`. */
  dateBlockDay: "font-mono text-base font-bold leading-tight",
  /** Real task checkbox: a 44px invisible target around the visual mark. */
  taskToggle:
    "peer absolute inset-0 h-11 w-11 cursor-pointer appearance-none rounded-lg border border-hair bg-card-hover transition-colors checked:border-flow/60 checked:bg-flow/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:cursor-not-allowed disabled:opacity-50",
  /** Visual mark of `taskToggle` (24px, centered in the 44px target). */
  taskToggleMark:
    "pointer-events-none flex h-6 w-6 items-center justify-center rounded-md border border-hair text-flow opacity-0 transition-opacity peer-checked:opacity-100",

  /* -- Hábitos (habitos-desktop.html / habitos-mobile.html) ----------------
   * The hero CTA, the category tabs, the legend swatches and the two matrix
   * skins (desktop month grid + mobile day strip). The strip and the grid are
   * different markup per DESIGN-SPEC D7, so their cell fills may differ. */

  /** Hero primary CTA (`Añadir Hábito`, gradient like the prototype `add_task`). */
  heroCta:
    "inline-flex min-h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-[#38BDF8] to-[#4F7CFF] px-4 py-2.5 font-display text-sm font-semibold text-slate-950 shadow-[0_0_18px_rgba(56,189,248,0.35)] transition-all hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal",
  /** Category tab, selected (prototype `bg-primary-container text-on-primary-container`). */
  filterTabActive:
    "inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-sky-500 px-3.5 text-xs font-semibold text-slate-950 shadow-[0_0_12px_rgba(56,189,248,0.3)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal",
  /** Category tab, idle. */
  filterTabIdle:
    "inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-hair bg-card px-3.5 text-xs font-semibold text-slate-400 transition-all hover:border-hair-strong hover:bg-card-hover hover:text-instrument focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal",
  /** Legend swatch: done cell. */
  legendSwatchDone: "h-3.5 w-3.5 rounded bg-signal shadow-[0_0_8px_rgba(56,189,248,0.5)]",
  /** Legend swatch: expected without a log. */
  legendSwatchPending: "h-3.5 w-3.5 rounded bg-container-high",
  /** Legend swatch: out of range / not yet. */
  legendSwatchFuture: "h-3.5 w-3.5 rounded bg-container-lowest/50",
  /** `HOY: <day>` chip of the legend row. */
  todayChip:
    "rounded bg-sky-500/15 px-2 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-sky-300",
  /** Month matrix card shell. */
  matrixPanel: "rounded-xl border border-hair bg-card p-4 shadow-sm",
  /** Matrix cell base (28px tall, fills its column). */
  matrixCell:
    "flex h-7 w-full items-center justify-center rounded font-mono text-[11px] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal",
  /** Matrix cell with a real log. */
  matrixCellDone: "bg-signal text-white shadow-[0_0_8px_rgba(56,189,248,0.4)] hover:bg-signal/90",
  /** Matrix cell expected but unlogged. */
  matrixCellPending: "bg-container-highest/60 text-slate-300 hover:bg-container-highest",
  /** Matrix cell outside the habit window / after today. */
  matrixCellFuture: "bg-container-lowest/50 text-slate-600",
  /** Extra emphasis on the today column, on top of a cell state. */
  matrixCellToday: "ring-1 ring-signal/60 shadow-[0_0_12px_rgba(56,189,248,0.45)]",
  /** Real current streak of a matrix row (the `Racha` column). */
  matrixRowStreak: "flex items-center justify-center gap-1 font-mono text-xs font-semibold tabular-nums text-signal",
  /** Real month success percentage of a matrix row (the `Éxito` column). */
  matrixRowPct: "flex items-center justify-center font-mono text-xs font-semibold tabular-nums text-flow-soft",
  /** Mobile per-habit card (`habitos-mobile.html` article). */
  habitCard: "flex flex-col gap-3 rounded-xl border border-hair bg-card p-3.5 shadow-sm",
  /** 36px icon tile inside a mobile habit card. */
  habitCardIcon: "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card-hover text-signal",
  /** `Marcar hoy` toggle base of a mobile habit card (44px thumb target). */
  habitTodayToggle:
    "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border transition-transform active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal",
  /** `Marcar hoy` toggle when today is already logged. */
  habitTodayDone: "border-flow/40 bg-flow/15 text-flow-soft shadow-[0_0_12px_rgba(82,232,124,0.35)]",
  /** `Marcar hoy` toggle when today has no log. */
  habitTodayIdle: "border-hair bg-card-hover text-slate-400 hover:text-instrument",
  /** Mobile day-strip cell base (24px wide). */
  habitDayCell:
    "flex h-7 w-6 shrink-0 items-center justify-center rounded font-mono text-[11px] font-bold tabular-nums",
  /** Strip cell with a real log. */
  habitDayDone: "bg-signal text-slate-950 shadow-[0_0_8px_rgba(56,189,248,0.4)]",
  /** Strip cell expected but unlogged. */
  habitDayPending: "bg-container-highest text-slate-400",
  /** Strip cell outside the habit window / after today. */
  habitDayFuture: "bg-container text-slate-600",
  /** Extra emphasis on the today cell of a strip, on top of a cell state. */
  habitDayToday: "ring-1 ring-signal/70 shadow-[0_0_10px_rgba(56,189,248,0.55)]",
  /** Real streak line of a mobile habit card footer. */
  habitCardStreak: "font-semibold text-signal",
  /** Streak line when there is nothing to count yet. */
  habitCardStreakPending: "text-slate-500",
  /** Effectiveness line of a mobile habit card footer. */
  habitCardEffectiveness: "text-slate-400",

  /* -- Hábitos bottom bento + history (habitos-desktop.html L697-806, ------
   * habitos-mobile.html L603-731) ----------------------------------------
   * Weekly consistency card, achievement bento, reflection note and the
   * history panel. Every figure they decorate is computed from the real logs
   * (D10); the prototype's `+450 XP` / `Nivel 4` never become literals. */

  /** Average badge of the weekly card (`PROMEDIO: 88%`). */
  weeklyAveragePill:
    "shrink-0 rounded-full bg-sky-500/15 px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-sky-300",
  /** Weekly bar channel (prototype `bg-surface-container-high rounded-t-lg`;
   * the phone prototype caps the bar at 28px, the desktop one fills the column). */
  weeklyBarTrack: "relative w-full max-w-8 overflow-hidden rounded-t-md bg-container-high sm:max-w-none",
  /** Weekly bar fill: the prototype's bottom-left gradient plus its cyan glow. */
  weeklyBarFill:
    "absolute inset-0 rounded-t-md bg-gradient-to-t from-[#4F7CFF] to-signal shadow-[0_0_12px_rgba(56,189,248,0.4)]",
  /** Weekly card footer row (best day + report link). */
  weeklyFooterRow:
    "mt-4 flex flex-col gap-1 rounded-lg bg-panel/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between",
  /** Achievement bento card: gradient chrome + overflow-hidden glow host. */
  achievementCard:
    "relative flex flex-col overflow-hidden rounded-xl border border-hair bg-gradient-to-br from-card to-panel p-5 shadow-sm",
  /** Achievement icon tile (prototype `bg-tertiary/15` + glow). */
  achievementIconTile:
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 shadow-[0_0_16px_rgba(16,185,129,0.3)]",
  /** `Hito Desbloqueado` pill (prototype `bg-surface-container-highest`). */
  achievementChip:
    "shrink-0 rounded-full bg-container-highest px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-instrument",
  /** Real level + real XP row at the bottom of the achievement card. */
  achievementStatsRow: "mt-4 flex items-center justify-between gap-2 rounded-lg bg-deck/60 p-3",
  /** Real XP figure of the achievement card (prototype `metric-val`). */
  achievementXpValue: "shrink-0 font-mono text-sm font-bold tabular-nums text-sky-400",
  /** Reflection note card (prototype `surface-container-low/90 backdrop-blur`). */
  reflectionCard: "flex items-start gap-3 rounded-xl border border-hair bg-panel/90 p-4 shadow-sm backdrop-blur-xl",
  /** Bulb tile of the reflection note. */
  reflectionIconTile: "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-container-high text-muted",
  /** Reflection eyebrow (`REFLEXIÓN DE PRODUCTIVIDAD`). */
  reflectionTitle: "font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-sky-400",
  /** One real statistic of the history panel (`dt` + `dd` pair). */
  statTile: "rounded-lg border border-hair bg-panel/50 px-3 py-2",
  /** History calendar cell (role=gridcell, not a control: 32px is honest). */
  historyCell: "flex h-8 items-center justify-center rounded-md font-mono text-[11px] tabular-nums",
  /** Compare chip of the history panel, wrapping a real checkbox. */
  compareChip:
    "flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-hair bg-card px-3 text-xs font-medium text-slate-400 transition-colors has-checked:border-sky-500/40 has-checked:bg-sky-500/15 has-checked:text-sky-300 has-disabled:cursor-not-allowed has-disabled:opacity-50",

  /* -- Login (login-desktop.html) -----------------------------------------
   * The one-card sign-in surface. Ported from the prototype's raw slate/sky
   * classes (kept as-is, like every other Tailwind palette class), plus the
   * 44px minimum target and reduced-motion guards the prototype lacks. Only
   * controls with real behaviour are rendered here (D10). */

  /** Card shell: translucent panel with a hairline border and deep shadow. */
  loginCard:
    "relative overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/80 p-7 shadow-2xl shadow-black/60 backdrop-blur-xl sm:p-9",
  /** 2px gradient hairline across the card's top edge. */
  loginTopHairline:
    "absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-sky-500/80 to-transparent",
  /** Hexagon logo tile (glow companion is `loginLogoGlow`). */
  loginLogoTile:
    "relative flex h-12 w-12 items-center justify-center rounded-xl border border-sky-400/30 bg-gradient-to-br from-sky-400/20 via-slate-800 to-slate-900 shadow-lg shadow-sky-500/20",
  /** Soft inner glow of `loginLogoTile`. */
  loginLogoGlow: "pointer-events-none absolute inset-0 rounded-xl bg-sky-400/10 blur-sm",
  /** Real-version badge next to the wordmark (value comes from the i18n constant). */
  loginVersionBadge:
    "inline-flex items-center rounded border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300",
  loginStatusPill:
    "inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-slate-950/80 px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide text-emerald-400 shadow-sm",
  /** Field label. */
  loginFieldLabel: "block text-xs font-semibold uppercase tracking-wider text-slate-300",
  /** Field control: the prototype recipe plus the 44px minimum target. */
  loginField:
    "min-h-11 w-full rounded-lg border border-slate-700/80 bg-slate-950/70 py-2.5 text-sm text-white transition duration-150 ease-in-out placeholder:text-slate-500 focus:border-sky-400 focus:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-sky-400/25",
  /** Leading field icon that follows the wrapper's focus-within state. */
  loginFieldIcon:
    "pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400 transition-colors group-focus-within:text-sky-400",
  /** Password show/hide toggle, kept at a real 44px target. */
  loginEyeToggle:
    "absolute right-0.5 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800/80 hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
  /** Submit CTA: the prototype gradient with hover/active/focus treatment. */
  loginCta:
    "group relative flex min-h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-gradient-to-r from-sky-600 via-sky-500 to-cyan-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-sky-500/25 transition-all duration-200 hover:from-sky-500 hover:to-cyan-400 hover:shadow-sky-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60 motion-reduce:transition-none",
  /** Hover wash of `loginCta`. */
  loginCtaOverlay:
    "pointer-events-none absolute inset-0 bg-white/10 opacity-0 transition-opacity group-hover:opacity-100 motion-reduce:transition-none",
  /** Secure-connection note in the card footer (the prototype's real claim). */
  loginSecureNote:
    "mt-6 flex items-center gap-1.5 border-t border-slate-800/80 pt-4 text-[11px] font-medium text-emerald-400",
  /** Page footer note under the card. */
  loginFooterNote: "mt-6 text-center text-xs text-slate-400",

  /* -- Ajustes family (settings hub + tokens/sessions) ---------------------
   * No Stitch prototype covers these routes, so these recipes replicate
   * nothing: they reuse the shared vocabulary of `dashboard-desktop.html`
   * (panel chrome, hairline headers, label-caps captions, deck actions) so
   * the settings family reads as the same product. Form fields here are
   * real controls, so they carry the 44px minimum target. */

  /** Real form field on a panel (the prototype's input recipe, 44px target).
   * The Finanzas filter tray keeps its own `filterField`. */
  fieldInput:
    "min-h-11 w-full rounded-lg border border-hair bg-deck px-3 text-sm text-instrument transition-colors placeholder:text-slate-500 focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/30",
  /** Caption above a real form field (prototype `label-caps`). */
  fieldLabel: "text-[11px] font-bold uppercase tracking-wider text-faint",
  /** Signal action with the 44px target: settings create/submit buttons. */
  signalAction:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3.5 text-xs font-semibold text-sky-300 transition-colors hover:bg-sky-500/25 glow-cyan-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:cursor-not-allowed disabled:opacity-50",
  /** Destructive row action (delete/revoke) on a panel. */
  dangerAction:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-hair bg-card px-3 text-xs font-semibold text-muted transition-colors hover:border-alert/60 hover:text-alert-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alert disabled:cursor-not-allowed disabled:opacity-50",
  /** Signal count/state pill (`1 activos`, `Actual`) on a settings header. */
  signalPill:
    "inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/15 px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-sky-300",
  /** Page-level error banner (`role="alert"`). */
  alertBanner:
    "rounded-xl border border-alert/50 bg-alert/10 px-3 py-2 text-sm text-alert-soft",
  /** Page-level success banner (`role="status"`). */
  successBanner:
    "rounded-xl border border-signal/40 bg-signal/10 px-3 py-2 text-sm text-signal",
  /** Radio pill of the shared period control: a real checkbox/radio wrapped in
   * the deck chip, selected state carried by `has-checked` (never by a
   * duplicate element). */
  periodPill:
    "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-full border border-hair bg-card px-3 text-xs font-medium text-muted transition-colors hover:border-hair-strong hover:text-instrument focus-within:border-signal/40 focus-within:ring-2 focus-within:ring-signal/30 has-checked:border-sky-500/40 has-checked:bg-sky-500/15 has-checked:text-sky-300",
} as const;

export const {
  panel,
  kpiTile,
  countPill,
  notificationCountPill,
  monoMicroLabel,
  primaryCta,
  ghostButton,
  segmentedTrack,
  segmentedActive,
  segmentedInactive,
  listRow,
  listRowMobile,
  sectionHeader,
  sectionHeaderWrap,
  sectionTitle,
  sectionSubtitle,
  cardFooterLink,
  cardFooterRow,
  emptyState,
  emptyIconBall,
  emptyTitle,
  emptyHint,
  kpiLabelRow,
  kpiIconChip,
  kpiIconChipSignal,
  kpiValue,
  kpiValueSignal,
  kpiValueFlow,
  kpiFooter,
  kpiFooterFlow,
  chartLegendRow,
  legendSwatchGlow,
  legendSwatchFlow,
  rowIconTile,
  rowChip,
  streakPill,
  streakPillCold,
  streakPillWarm,
  streakPillHot,
  pageTitle,
  currencyChip,
  toolbarActionNeutral,
  toolbarActionSignal,
  toolbarActionFlow,
  headerIconButton,
  accountTile,
  accountAvatar,
  accountCaption,
  tileAction,
  tileActionSignal,
  tileActionNeutral,
  filterTray,
  filterLabel,
  filterField,
  filterChipActive,
  filterChipIdle,
  listRowTransfer,
  chartRangeLabel,
  quickCard,
  quickCardIcon,
  quickCardTitle,
  quickCardCopy,
  focusChip,
  focusChipDot,
  syncChip,
  syncChipPending,
  headerAction,
  headerActionSignal,
  kpiProgressTrack,
  kpiProgressFillSignal,
  kpiProgressFillFlow,
  kpiChipAlert,
  kpiChipNeutral,
  kpiDeltaUp,
  kpiDeltaDown,
  calendarPanel,
  calendarHeader,
  calendarIconTile,
  calendarTitle,
  calendarTelemetry,
  calendarLegend,
  calendarLegendDotTask,
  calendarLegendDotEvent,
  calendarNavGroup,
  calendarNavButton,
  calendarCell,
  calendarCellToday,
  calendarCellMarkers,
  calendarMarker,
  calendarMarkerCount,
  cardRow,
  goalDot,
  cardMetric,
  cardProgressTrack,
  cardAction,
  cardPillIdle,
  cardPillActive,
  cardTextAction,
  cardTextActionSignal,
  dateBlock,
  dateBlockMonth,
  dateBlockDay,
  taskToggle,
  taskToggleMark,
  heroCta,
  filterTabActive,
  filterTabIdle,
  legendSwatchDone,
  legendSwatchPending,
  legendSwatchFuture,
  todayChip,
  matrixPanel,
  matrixCell,
  matrixCellDone,
  matrixCellPending,
  matrixCellFuture,
  matrixCellToday,
  matrixRowStreak,
  matrixRowPct,
  habitCard,
  habitCardIcon,
  habitTodayToggle,
  habitTodayDone,
  habitTodayIdle,
  habitDayCell,
  habitDayDone,
  habitDayPending,
  habitDayFuture,
  habitDayToday,
  habitCardStreak,
  habitCardStreakPending,
  habitCardEffectiveness,
  weeklyAveragePill,
  weeklyBarTrack,
  weeklyBarFill,
  weeklyFooterRow,
  achievementCard,
  achievementIconTile,
  achievementChip,
  achievementStatsRow,
  achievementXpValue,
  reflectionCard,
  reflectionIconTile,
  reflectionTitle,
  statTile,
  historyCell,
  compareChip,
  loginCard,
  loginTopHairline,
  loginLogoTile,
  loginLogoGlow,
  loginVersionBadge,
  loginStatusPill,
  loginFieldLabel,
  loginField,
  loginFieldIcon,
  loginEyeToggle,
  loginCta,
  loginCtaOverlay,
  loginSecureNote,
  loginFooterNote,
} = deck;
