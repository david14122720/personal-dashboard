"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import NotificationBell from "@/components/notifications/NotificationBell";
import { logout } from "@/lib/api/client";
import { useHabitsToday, usePreferences } from "@/lib/api/dashboard";
import { t, type EsKey } from "@/lib/i18n";
import { BOGOTA_TZ } from "@/lib/time/bogota";

type IconProps = { className?: string };

// Minimal inline nav icons (stroke = currentColor, decorative only, D3).
function GridIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="3" y="3" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="3" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function WalletIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="2.5" y="5" width="15" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 8.5h15" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="14.5" cy="12.5" r="1" fill="currentColor" />
    </svg>
  );
}

function BoardIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="4.5" y="3.5" width="11" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M7.5 8h5M7.5 11h5M7.5 14h3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckCircleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M7.5 10.2l1.8 1.8 3.2-3.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Sliders ("tune"): the Ajustes hub glyph in the design. */
function SlidersIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M3 6h14M3 13h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7.5" cy="6" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12.5" cy="13" r="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function KeyIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <circle cx="6.8" cy="6.8" r="3.3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9.2 9.2l6.3 6.3M13.2 13.2l1.8-1.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LogoutIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12.5 3.5H15a1 1 0 011 1v11a1 1 0 01-1 1h-2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M3.5 10h8M8.5 6.5L5 10l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Brand cube: the design's package glyph, drawn in the repo icon style. */
function CubeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M10 2.6l6 3.3v7.9l-6 3.3-6-3.3V5.9l6-3.3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M4 6l6 3.3L16 6M10 9.3V17"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalendarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="3" y="4.5" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3 8.5h14M7 3v3M13 3v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M7.5 4.5L13 10l-5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Fallback avatar while the real identity read is pending or failed. */
function UserIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <circle cx="10" cy="6.5" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M4.6 16.5c.6-2.6 2.8-4.2 5.4-4.2s4.8 1.6 5.4 4.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DeviceIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="2.5" y="4" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 16h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="14" y="8.5" width="3.5" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

type NavItem = {
  href: string;
  labelKey: EsKey;
  Icon: (props: IconProps) => React.JSX.Element;
  /** Rail-only badge whose number comes from real data, never a constant. */
  chip?: "activeHabits";
};

// D11: the design's group headers, the app's real labels.
const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard/", labelKey: "nav.overview", Icon: GridIcon },
  { href: "/dashboard/finance/", labelKey: "nav.finance", Icon: WalletIcon },
  { href: "/dashboard/productivity/", labelKey: "nav.productivity", Icon: BoardIcon },
  { href: "/dashboard/habitos/", labelKey: "nav.habits", Icon: CheckCircleIcon, chip: "activeHabits" },
];

const SETTINGS_NAV: NavItem[] = [
  { href: "/dashboard/ajustes/", labelKey: "nav.general", Icon: SlidersIcon },
  { href: "/dashboard/ajustes/tokens/", labelKey: "nav.tokens", Icon: KeyIcon },
  { href: "/dashboard/ajustes/sesiones/", labelKey: "nav.sessions", Icon: DeviceIcon },
];

/**
 * Mobile bottom bar: exactly the design's five destinations. `Tokens de API`
 * and `Sesiones` leave the bar and stay reachable from the Ajustes hub
 * (DESIGN-SPEC IA: five tabs, the settings children live under Ajustes).
 */
const TAB_NAV: NavItem[] = [...PRIMARY_NAV, SETTINGS_NAV[0]];

/* Shell chrome recipes (canonical: dashboard-desktop.html L72-232). They live
 * here because the shell is their only consumer; cross-surface recipes are
 * shared through `frontend/components/ui/deckStyles.ts` (`ghostButton`,
 * `notificationCountPill`, ...). */
const RAIL_GROUP_FIRST = "px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-muted";
const RAIL_GROUP = `${RAIL_GROUP_FIRST} pt-4`;
const RAIL_ITEM_BASE =
  "relative flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm transition-colors";
const RAIL_ITEM_ACTIVE = "border-sky-500/30 bg-sky-500/10 font-medium text-instrument";
const RAIL_ITEM_IDLE =
  "border-transparent font-medium text-slate-400 hover:bg-card hover:text-instrument";
const RAIL_ACTIVE_DOT = "h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400 shadow-[0_0_8px_#38bdf8]";
const RAIL_HABITS_CHIP =
  "ml-auto shrink-0 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-400";
const TAB_ITEM_BASE =
  "flex min-h-[44px] min-w-[56px] flex-col items-center justify-center gap-0.5 px-1 py-1 transition-colors";
const TAB_ITEM_ACTIVE = "font-semibold text-signal";
const TAB_ITEM_IDLE = "text-instrument/70 hover:text-instrument";
const BRAND_VERSION_BADGE =
  "shrink-0 rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-sky-400";
const IDENTITY_AVATAR =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-sky-500 to-indigo-600 text-xs font-bold text-white shadow-inner";
const IDENTITY_LOGOUT =
  "shrink-0 rounded p-1.5 text-slate-400 transition-colors hover:bg-hair hover:text-rose-400 focus-visible:outline-2 focus-visible:outline-signal";

/** Real initials only: from the display name when present, else the email
 * local part. `null` when neither exists, so the card keeps the honest
 * fallback instead of inventing letters (D10). */
function identityInitials(displayName: string, email: string): string | null {
  if (displayName) {
    const parts = displayName.split(/\s+/).filter(Boolean);
    if (parts.length > 1) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return null;
}

/** Real identity behind `GET /me`: the display name when present, else the
 * email, else nothing. Shared by the sidebar footer card and by the mobile
 * avatar link so both name the same person (never an invented one, D10). */
function useIdentity(): { displayName: string; email: string; initials: string | null; primary: string } {
  const prefs = usePreferences();
  const me = prefs.data as
    | { email?: string | null; display_name?: string | null }
    | undefined;
  const displayName = me?.display_name?.trim() ?? "";
  const email = me?.email?.trim() ?? "";
  return { displayName, email, initials: identityInitials(displayName, email), primary: displayName || email };
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard/") return pathname === "/dashboard" || pathname === "/dashboard/";
  const clean = (p: string): string => (p.endsWith("/") && p.length > 1 ? p.slice(0, -1) : p);
  const target = clean(href);
  const current = clean(pathname);
  // The settings hub owns only its own page; children (tokens) highlight alone.
  if (target === "/dashboard/ajustes") return current === target;
  return current === target || current.startsWith(`${target}/`);
}

/** Bogotá date in the app's single locale (`es-CO`, short month). */
function formatToday(date: Date): string {
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: BOGOTA_TZ,
  }).format(date);
}

function RailLink({
  item,
  pathname,
  activeHabits,
}: {
  item: NavItem;
  pathname: string;
  activeHabits: number | null;
}) {
  const active = isActive(pathname, item.href);
  const Icon = item.Icon;
  // Honest chip: only when the real count is known and non-zero.
  const showChip = item.chip === "activeHabits" && activeHabits !== null && activeHabits > 0;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`${RAIL_ITEM_BASE} ${active ? RAIL_ITEM_ACTIVE : RAIL_ITEM_IDLE}`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${active ? "text-sky-400" : "text-slate-500"}`} />
      <span className={active ? "text-sky-300" : undefined}>{t(item.labelKey)}</span>
      {showChip ? (
        <span className={RAIL_HABITS_CHIP}>
          {t("nav.activeHabitsChip", { n: activeHabits })}
        </span>
      ) : null}
      {active ? (
        <span aria-hidden="true" className={`${RAIL_ACTIVE_DOT} ${showChip ? "" : "ml-auto"}`} />
      ) : null}
    </Link>
  );
}

function RailNav() {
  const pathname = usePathname() ?? "";
  const habits = useHabitsToday();
  const habitsData = habits.data;
  const activeHabits = habits.error || !habitsData ? null : habitsData.length;
  return (
    <nav aria-label={t("nav.primary")} className="space-y-1.5 p-4">
      <p className={RAIL_GROUP_FIRST}>{t("nav.sectionMain")}</p>
      {PRIMARY_NAV.map((item) => (
        <RailLink key={item.href} item={item} pathname={pathname} activeHabits={activeHabits} />
      ))}
      <p className={RAIL_GROUP}>{t("nav.sectionSystem")}</p>
      {SETTINGS_NAV.map((item) => (
        <RailLink key={item.href} item={item} pathname={pathname} activeHabits={activeHabits} />
      ))}
    </nav>
  );
}

/** Sidebar footer card (`dashboard-desktop.html:157-170`): the real signed-in
 * identity when `GET /me` answered, initials avatar, name + email and the
 * logout control. The shared wire type only declares `preferences` — read the
 * identity fields structurally instead of widening a lib outside this task.
 * While the read is loading or failed the card states the honest local
 * session, exactly as before, and never invents a name or an email. */
function SessionCard() {
  const { displayName, email, initials, primary } = useIdentity();
  const secondary = displayName ? email : "";
  return (
    <div className="border-t border-hair p-4">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-hair bg-card p-2">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className={IDENTITY_AVATAR}>
            {initials ?? <UserIcon className="h-4 w-4" />}
          </span>
          {/* Fixed light slate: the identity card keeps a dark surface in both
              themes, so it must not inherit the theme-flipped token (D9). */}
          {primary ? (
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-xs font-semibold text-slate-100" title={primary}>
                {primary}
              </p>
              {secondary ? (
                <p className="truncate text-[11px] text-slate-400" title={secondary}>
                  {secondary}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="truncate text-xs font-semibold text-slate-100">
              {t("nav.localSession")}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          aria-label={t("nav.signOut")}
          title={t("nav.signOut")}
          className={IDENTITY_LOGOUT}
        >
          <LogoutIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function MobileTabBar() {
  const pathname = usePathname() ?? "";
  return (
    <nav
      aria-label={t("nav.primary")}
      className="pb-safe fixed inset-x-0 bottom-0 z-40 bg-panel/85 backdrop-blur-xl md:hidden"
    >
      <div className="flex h-16 items-center justify-around px-1">
        {TAB_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.Icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`${TAB_ITEM_BASE} ${active ? TAB_ITEM_ACTIVE : TAB_ITEM_IDLE}`}
            >
              <Icon className="h-[22px] w-[22px] shrink-0" />
              <span className="text-label-caps">{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Fixed mobile chrome: brand chip, notification surface, session affordances. */
function MobileChrome() {
  const { primary } = useIdentity();
  // The avatar link is icon-only, so its accessible name carries both the real
  // identity (when known) and the destination it leads to (JD item 7); it used
  // to claim "Sesión local" without saying where it goes.
  const sessionLabel = primary
    ? t("nav.sessionSettingsFor", { identity: primary })
    : t("nav.sessionSettings");
  return (
    <>
      <header className="pt-safe fixed inset-x-0 top-0 z-40 border-b border-hair bg-deck/80 backdrop-blur-md md:hidden">
        <div className="flex h-14 items-center justify-between gap-2 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-sky-500/30 bg-sky-500/10 text-signal">
              <CubeIcon className="h-4 w-4" />
            </span>
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-headline-md tracking-tight">
                Control <span className="text-signal">Deck</span>
              </span>
              <span className={BRAND_VERSION_BADGE}>{t("nav.brandVersion")}</span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <NotificationBell variant="compact" />
            <Link
              href="/dashboard/ajustes/"
              aria-label={sessionLabel}
              title={sessionLabel}
              className="flex h-11 w-11 items-center justify-center rounded-full text-instrument/70 transition-colors hover:text-instrument focus-visible:outline-2 focus-visible:outline-signal"
            >
              <UserIcon className="h-5 w-5" />
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              aria-label={t("nav.signOutShort")}
              title={t("nav.signOut")}
              className="flex h-11 w-11 items-center justify-center rounded-full text-instrument/70 transition-colors hover:text-alert focus-visible:outline-2 focus-visible:outline-signal"
            >
              <LogoutIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>
      <MobileTabBar />
    </>
  );
}

function TopBar() {
  const pathname = usePathname() ?? "";
  // Render the date after mount so the statically exported HTML never disagrees with the client clock.
  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(formatToday(new Date()));
  }, []);
  const section = [...PRIMARY_NAV, ...SETTINGS_NAV].find((item) => isActive(pathname, item.href));
  return (
    <header className="sticky top-0 z-20 hidden h-16 items-center justify-between gap-4 border-b border-hair bg-deck/80 px-6 backdrop-blur-md md:flex">
      <nav
        aria-label={t("dashboard.breadcrumbNav")}
        className="flex min-w-0 items-center gap-2 text-xs font-medium text-slate-400"
      >
        <span className="shrink-0">{t("dashboard.panel")}</span>
        {section ? (
          <>
            <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
            <span className="truncate font-semibold text-sky-400">{t(section.labelKey)}</span>
          </>
        ) : null}
      </nav>
      <div className="flex shrink-0 items-center gap-3">
        <p className="hidden items-center gap-2 rounded-lg border border-hair bg-panel px-3 py-1.5 font-mono text-xs text-slate-300 lg:flex">
          <CalendarIcon className="h-3.5 w-3.5 text-sky-400" />
          {today}
        </p>
        <NotificationBell />
      </div>
    </header>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  // The shell owns the single notification surface on every route (the
  // prototype puts it in the topbar, `dashboard-desktop.html:210-219`): one
  // desktop branch and one mobile branch, exactly one visible at a time.
  return (
    <div className="min-h-screen bg-deck text-instrument">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-signal focus:px-3 focus:py-2 focus:text-deck"
      >
        {t("nav.skipToContent")}
      </a>
      <MobileChrome />
      <div className="flex min-h-screen">
        <aside className="sticky top-0 z-30 hidden h-screen w-64 shrink-0 flex-col justify-between border-r border-hair bg-panel md:flex">
          <div className="flex flex-col">
            <div className="flex h-16 items-center gap-3 border-b border-hair px-6">
              <span className="glow-cyan-sm flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-400">
                <CubeIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-base font-bold tracking-tight">
                  Control <span className="text-signal">Deck</span>
                  <span className={BRAND_VERSION_BADGE}>{t("nav.brandVersion")}</span>
                </p>
                <p className="text-[11px] text-muted">{t("nav.brandSubline")}</p>
              </div>
            </div>
            <RailNav />
          </div>
          <SessionCard />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col bg-deck">
          <TopBar />
          <main
            id="main-content"
            className="flex-1 px-4 pb-32 pt-[calc(3.5rem+env(safe-area-inset-top,0px))] md:px-6 md:pb-10 md:pt-6 xl:px-8"
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
