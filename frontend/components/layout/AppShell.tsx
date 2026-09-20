"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

const NAV_ITEMS: Array<{ href: string; labelKey: EsKey; Icon: (props: IconProps) => React.JSX.Element }> = [
  { href: "/dashboard/", labelKey: "nav.overview", Icon: GridIcon },
  { href: "/dashboard/finance/", labelKey: "nav.finance", Icon: WalletIcon },
  { href: "/dashboard/productivity/", labelKey: "nav.productivity", Icon: BoardIcon },
  { href: "/dashboard/habitos/", labelKey: "nav.habits", Icon: CheckCircleIcon },
  { href: "/dashboard/ajustes/tokens/", labelKey: "nav.tokens", Icon: KeyIcon },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard/") return pathname === "/dashboard" || pathname === "/dashboard/";
  return pathname.startsWith(href.replace(/\/$/, ""));
}

// Active glow shared by the desktop rail (Stitch accent + signal shadow).
const ACTIVE_GLOW = "shadow-[0_0_20px_-6px_var(--color-signal)]";

function NavLinks({ orientation }: { orientation: "rail" | "tabs" }) {
  const pathname = usePathname();
  const base =
    orientation === "rail"
      ? "flex flex-col gap-1 p-3"
      : "flex flex-row justify-around border-t border-hull bg-deck px-2 py-2";
  return (
    <nav aria-label="Primary" className={base}>
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname ?? "", item.href);
        const Icon = item.Icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              orientation === "rail"
                ? `flex items-center gap-2.5 rounded-lg border px-3 py-2 font-display text-sm tracking-wide transition-colors ${
                    active
                      ? `border-signal/30 bg-signal/15 text-signal ${ACTIVE_GLOW}`
                      : "border-transparent text-instrument/70 hover:bg-hull/60 hover:text-instrument"
                  }`
                : `flex flex-col items-center gap-0.5 rounded-md px-3 py-1.5 font-display text-[11px] tracking-wide transition-colors ${
                    active
                      ? "bg-signal/10 font-semibold text-signal"
                      : "text-instrument/70 hover:text-instrument"
                  }`
            }
          >
            <Icon className={orientation === "rail" ? "h-[18px] w-[18px] shrink-0" : "h-4 w-4 shrink-0"} />
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-deck text-instrument">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-signal focus:px-3 focus:py-2 focus:text-deck"
      >
        Skip to content
      </a>
      <div className="mx-auto flex min-h-screen max-w-7xl">
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-hull bg-deck md:flex">
          <div className="flex items-center gap-2.5 px-4 pb-2 pt-5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#006edc] to-[#38bdf8] ring-1 ring-white/20">
              <DeckGlyph className="h-4 w-4 text-white" />
            </span>
            <p className="font-display text-lg font-semibold tracking-wide">
              Control <span className="text-signal">Deck</span>
            </p>
          </div>
          <div className="flex-1">
            <NavLinks orientation="rail" />
          </div>
          {/* No user profile exists in the app: the card holds only sign-out. */}
          <div className="p-3">
            <div className="rounded-xl border border-hull bg-hull/40 p-2">
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-transparent px-3 py-2 font-display text-sm text-instrument/70 transition-colors hover:border-alert/50 hover:text-alert"
              >
                <LogoutIcon className="h-4 w-4 shrink-0" />
                {t("nav.signOut")}
              </button>
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <main id="main-content" className="flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-10">
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
