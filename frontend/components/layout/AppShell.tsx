"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import NotificationBell from "@/components/notifications/NotificationBell";
import { logout } from "@/lib/api/client";
import { t, type EsKey } from "@/lib/i18n";

type IconProps = { className?: string };

// Minimal inline nav icons (stroke = currentColor, decorative only).
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

function SearchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13.2 13.2L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function DeckGlyph({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" fill="currentColor" opacity="0.95" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" fill="currentColor" opacity="0.65" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" fill="currentColor" opacity="0.65" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="3.5" fill="currentColor" opacity="0.95" />
    </svg>
  );
}

type NavItem = {
  href: string;
  labelKey: EsKey;
  Icon: (props: IconProps) => React.JSX.Element;
};

// Primary destinations keep the Stitch "Principal" group; settings owns its own caption.
const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard/", labelKey: "nav.overview", Icon: GridIcon },
  { href: "/dashboard/finance/", labelKey: "nav.finance", Icon: WalletIcon },
  { href: "/dashboard/productivity/", labelKey: "nav.productivity", Icon: BoardIcon },
  { href: "/dashboard/habitos/", labelKey: "nav.habits", Icon: CheckCircleIcon },
];

const SETTINGS_NAV: NavItem[] = [
  { href: "/dashboard/ajustes/", labelKey: "nav.general", Icon: GridIcon },
  { href: "/dashboard/ajustes/tokens/", labelKey: "nav.tokens", Icon: KeyIcon },
];

// Mobile bottom tabs stay flat and keep the original five destinations.
const NAV_ITEMS: NavItem[] = [...PRIMARY_NAV, ...SETTINGS_NAV];

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard/") return pathname === "/dashboard" || pathname === "/dashboard/";
  const clean = (p: string): string => (p.endsWith("/") && p.length > 1 ? p.slice(0, -1) : p);
  const target = clean(href);
  const current = clean(pathname);
  // The settings hub owns only its own page; children (tokens) highlight alone.
  if (target === "/dashboard/ajustes") return current === target;
  return current === target || current.startsWith(`${target}/`);
}

function formatToday(date: Date): string {
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function RailLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  const Icon = item.Icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-3 rounded-lg border px-3 py-2.5 font-display text-sm tracking-wide transition-colors ${
        active
          ? "glow-cyan-soft border-signal/30 bg-signal/15 font-semibold text-signal"
          : "border-transparent font-medium text-slate-400 hover:bg-slate-800/50 hover:text-slate-100"
      }`}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="absolute bottom-1.5 left-0 top-1.5 w-1 rounded-r-full bg-signal"
        />
      ) : null}
      <Icon className="h-4 w-4 shrink-0" />
      {t(item.labelKey)}
    </Link>
  );
}

function NavLinks({ orientation }: { orientation: "rail" | "tabs" }) {
  const pathname = usePathname();
  if (orientation === "tabs") {
    return (
      <nav
        aria-label={t("nav.primary")}
        className="flex flex-row justify-around border-t border-hull bg-deck px-2 py-2"
      >
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname ?? "", item.href);
          const Icon = item.Icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 rounded-md px-3 py-1.5 font-display text-[11px] tracking-wide transition-colors ${
                active
                  ? "bg-signal/10 font-semibold text-signal"
                  : "text-instrument/70 hover:text-instrument"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
    );
  }
  return (
    <nav aria-label={t("nav.primary")} className="flex flex-col gap-1 p-3">
      <p className="label-caps px-3 pb-1 pt-3 text-slate-500">{t("nav.sectionMain")}</p>
      {PRIMARY_NAV.map((item) => (
        <RailLink key={item.href} item={item} pathname={pathname ?? ""} />
      ))}
      <p className="label-caps px-3 pb-1 pt-5 text-slate-500">{t("nav.settings")}</p>
      {SETTINGS_NAV.map((item) => (
        <RailLink key={item.href} item={item} pathname={pathname ?? ""} />
      ))}
    </nav>
  );
}

function TopBar() {
  const pathname = usePathname() ?? "";
  // Render the date after mount so the statically exported HTML never disagrees with the client clock.
  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(formatToday(new Date()));
  }, []);
  const section = NAV_ITEMS.find((item) => isActive(pathname, item.href));
  // DashboardHome already renders the NotificationBell next to its title; skip the topbar
  // instance on that route so the bell is never duplicated (one bell per screen).
  const showBell = !isActive(pathname, "/dashboard/");
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-800/80 bg-[#0f131d]/90 px-4 backdrop-blur-md md:px-6 xl:px-8">
      <nav
        aria-label={t("dashboard.breadcrumbNav")}
        className="flex min-w-0 items-center gap-2 text-xs"
      >
        <span className="shrink-0 text-slate-400">{t("dashboard.panel")}</span>
        {section ? (
          <>
            <span aria-hidden="true" className="text-slate-600">
              /
            </span>
            <span className="truncate font-semibold text-signal">{t(section.labelKey)}</span>
          </>
        ) : null}
      </nav>
      {/* Decorative search: global search is not implemented; the field stays inert on purpose. */}
      <div className="hidden min-w-0 flex-1 justify-center px-6 md:flex">
        <div className="relative w-full max-w-md">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            readOnly
            aria-disabled="true"
            placeholder={t("nav.searchPlaceholder")}
            title={t("nav.searchUnavailable")}
            className="w-full cursor-not-allowed rounded-lg border border-slate-800 bg-[#171b26] py-1.5 pl-9 pr-3 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none"
          />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {/* Decorative status pill: there is no live feed yet. */}
        <div
          role="status"
          className="hidden items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400 md:flex"
        >
          <span aria-hidden="true" className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span>{t("nav.live")}</span>
        </div>
        <p className="hidden rounded-lg border border-slate-800 bg-[#171b26] px-3 py-1.5 text-xs font-medium text-slate-400 md:block">
          {today}
        </p>
        {showBell ? <NotificationBell /> : null}
      </div>
    </header>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-abyss text-instrument">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-signal focus:px-3 focus:py-2 focus:text-deck"
      >
        {t("nav.skipToContent")}
      </a>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between border-r border-slate-800/80 bg-[#0f131d] md:flex">
          <div className="flex flex-col">
            <div className="flex h-16 items-center gap-3 border-b border-slate-800/60 px-6">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#006edc] to-[#38bdf8] ring-1 ring-white/20">
                <DeckGlyph className="h-4 w-4 text-white" />
              </span>
              <p className="font-display text-lg font-semibold tracking-wide">
                Control <span className="text-signal">Deck</span>
              </p>
            </div>
            <NavLinks orientation="rail" />
          </div>
          {/* No user profile exists in the app: the footer only states the local session and signs out. */}
          <div className="border-t border-slate-800/80 bg-[#0c101a] p-3">
            <p className="label-caps px-3 pb-2 pt-1 text-slate-500">{t("nav.localSession")}</p>
            <button
              type="button"
              onClick={logout}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-transparent px-3 py-2 font-display text-sm text-slate-400 transition-colors hover:border-alert/50 hover:text-alert"
            >
              <LogoutIcon className="h-4 w-4 shrink-0" />
              {t("nav.signOut")}
            </button>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col bg-abyss">
          <TopBar />
          <main id="main-content" className="flex-1 px-4 pb-24 pt-6 md:px-6 md:pb-10 xl:px-8">
            {children}
          </main>
          <div className="fixed inset-x-0 bottom-0 z-40 md:hidden">
            <NavLinks orientation="tabs" />
          </div>
        </div>
      </div>
    </div>
  );
}
