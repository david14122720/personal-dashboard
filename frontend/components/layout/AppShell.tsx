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

function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12.5 4.5L7 10l5.5 5.5"
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

/** Owner-provided Hermes mark: helmet/shield with a cross, stroke-only. */
function HermesIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" opacity="0.2" />
      <path d="M12 6l-5 3v3c0 3.5 2.5 6.8 5 7.5 2.5-.7 5-4 5-7.5V9l-5-3z" />
      <path d="M9 12h6M12 9v6" />
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
  { href: "/dashboard/hermes/", labelKey: "nav.hermes", Icon: HermesIcon },
];

// SISTEMA is a single destination: the unified Ajustes hub owns its tabs.
const SETTINGS_NAV: NavItem[] = [
  { href: "/dashboard/ajustes/", labelKey: "nav.general", Icon: SlidersIcon },
];

/**
 * Mobile bottom bar: exactly the design's five destinations. `Tokens de API`
 * and `Sesiones` leave the bar and stay reachable as tabs of the Ajustes hub
 * (DESIGN-SPEC IA: five tabs, the settings children live under Ajustes).
 */
// The mobile bar keeps the design's five destinations. Hermes is a desktop
// rail destination (its chat page is still responsive and deep-linkable);
// squeezing a sixth tab into 390 px merged the first four labels.
const TAB_NAV: NavItem[] = [
  ...PRIMARY_NAV.filter((item) => item.href !== "/dashboard/hermes/"),
  SETTINGS_NAV[0],
];

/* Shell chrome recipes (canonical: dashboard-desktop.html L72-232). They live
 * here because the shell is their only consumer; cross-surface recipes are
 * shared through `frontend/components/ui/deckStyles.ts` (`ghostButton`,
 * `notificationCountPill`, ...). */
const RAIL_GROUP_FIRST = "px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-muted";
const RAIL_GROUP = `${RAIL_GROUP_FIRST} pt-4`;
const RAIL_ITEM_BASE =
  "relative flex items-center rounded-lg border py-2.5 text-sm transition-colors";
const RAIL_ITEM_EXPANDED = "gap-3 px-3.5";
const RAIL_ITEM_COLLAPSED = "mx-auto h-11 w-11 justify-center px-0";
const RAIL_TOOLTIP =
  "pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-hair bg-card px-2 py-1 text-xs font-medium text-instrument opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100";
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
  // The unified Ajustes hub also owns its tab routes; the rail lights the hub.
  return current === target || current.startsWith(`${target}/`);
}

const SIDEBAR_STORAGE_KEY = "pd-sidebar-collapsed";

/** Read the saved rail preference; storage can be unavailable (private mode,
 * disabled cookies) and must never break the shell. */
function readSidebarPreference(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Expanded on the first paint (the static HTML), restored after mount so the
 * client and the exported shell never disagree during hydration. */
function useCollapsedSidebar(): { collapsed: boolean; toggle: () => void } {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(readSidebarPreference());
  }, []);
  function toggle(): void {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // The rail still toggles for this page view; only persistence is lost.
      }
      return next;
    });
  }
  return { collapsed, toggle };
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
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  activeHabits: number | null;
  collapsed: boolean;
}) {
  const active = isActive(pathname, item.href);
  const Icon = item.Icon;
  const label = t(item.labelKey);
  // Honest chip: only when the real count is known and non-zero. The icon rail
  // has no room for it; the active background still marks the destination.
  const showChip =
    !collapsed && item.chip === "activeHabits" && activeHabits !== null && activeHabits > 0;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      data-tooltip={collapsed ? label : undefined}
      className={`group ${RAIL_ITEM_BASE} ${collapsed ? RAIL_ITEM_COLLAPSED : RAIL_ITEM_EXPANDED} ${
        active ? RAIL_ITEM_ACTIVE : RAIL_ITEM_IDLE
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${active ? "text-sky-400" : "text-slate-500"}`} />
      {collapsed ? (
        <span data-rail-tooltip aria-hidden="true" className={RAIL_TOOLTIP}>
          {label}
        </span>
      ) : (
        <span data-rail-label className={active ? "text-sky-300" : undefined}>
          {label}
        </span>
      )}
      {showChip ? (
        <span className={RAIL_HABITS_CHIP}>
          {t("nav.activeHabitsChip", { n: activeHabits })}
        </span>
      ) : null}
      {active && !collapsed ? (
        <span aria-hidden="true" className={`${RAIL_ACTIVE_DOT} ${showChip ? "" : "ml-auto"}`} />
      ) : null}
    </Link>
  );
}

function RailNav({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname() ?? "";
  const habits = useHabitsToday();
  const habitsData = habits.data;
  const activeHabits = habits.error || !habitsData ? null : habitsData.length;
  return (
    <nav
      aria-label={t("nav.primary")}
      className={collapsed ? "space-y-1.5 p-2.5" : "space-y-1.5 p-4"}
    >
      {collapsed ? null : <p className={RAIL_GROUP_FIRST}>{t("nav.sectionMain")}</p>}
      {PRIMARY_NAV.map((item) => (
        <RailLink
          key={item.href}
          item={item}
          pathname={pathname}
          activeHabits={activeHabits}
          collapsed={collapsed}
        />
      ))}
      {collapsed ? null : <p className={RAIL_GROUP}>{t("nav.sectionSystem")}</p>}
      {SETTINGS_NAV.map((item) => (
        <RailLink
          key={item.href}
          item={item}
          pathname={pathname}
          activeHabits={activeHabits}
          collapsed={collapsed}
        />
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
function SessionCard({ collapsed }: { collapsed: boolean }) {
  const { displayName, email, initials, primary } = useIdentity();
  const secondary = displayName ? email : "";
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 border-t border-hair p-3">
        <span aria-hidden="true" className={IDENTITY_AVATAR}>
          {initials ?? <UserIcon className="h-4 w-4" />}
        </span>
        <button
          type="button"
          onClick={() => void logout()}
          aria-label={t("nav.signOut")}
          title={t("nav.signOut")}
          className="flex h-11 w-11 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-hair hover:text-rose-400 focus-visible:outline-2 focus-visible:outline-signal"
        >
          <LogoutIcon className="h-4 w-4" />
        </button>
      </div>
    );
  }
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
              <img src="/logo.svg" alt="" className="h-5 w-5" />
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
  const { collapsed, toggle } = useCollapsedSidebar();
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
        <aside
          id="app-sidebar"
          className={`sticky top-0 z-30 hidden h-screen shrink-0 flex-col justify-between border-r border-hair bg-panel transition-[width] duration-200 md:flex ${
            collapsed ? "md:w-[72px]" : "md:w-64"
          }`}
        >
          <div className="flex flex-col">
            <div
              className={`relative flex h-16 items-center border-b border-hair ${
                collapsed ? "justify-center px-2" : "gap-3 px-6"
              }`}
            >
              <span className="glow-cyan-sm flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-400">
                {/* Official brand asset; the square tile keeps the 1:1 ratio. */}
                <img src="/logo.svg" alt="" className="h-6 w-6" />
              </span>
              {collapsed ? null : (
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-base font-bold tracking-tight">
                    Control <span className="text-signal">Deck</span>
                    <span className={BRAND_VERSION_BADGE}>{t("nav.brandVersion")}</span>
                  </p>
                  <p className="text-[11px] text-muted">{t("nav.brandSubline")}</p>
                </div>
              )}
              {/* Floating dock handle on the border: it consumes no header
                  width, so the brand block never collides with it at either
                  width (Judgment Day round 1). */}
              <button
                type="button"
                onClick={toggle}
                aria-label={
                  collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")
                }
                aria-expanded={!collapsed}
                aria-controls="app-sidebar"
                title={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
                className="group/toggle absolute -right-[22px] top-1/2 z-40 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 focus-visible:outline-2 focus-visible:outline-signal"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-hair bg-panel shadow-sm transition-colors group-hover/toggle:text-sky-400">
                  <ChevronLeftIcon
                    className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`}
                  />
                </span>
              </button>
            </div>
            <RailNav collapsed={collapsed} />
          </div>
          <SessionCard collapsed={collapsed} />
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
