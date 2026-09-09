"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/api/client";
import { t } from "@/lib/i18n";

const NAV_ITEMS = [
  { href: "/dashboard/", labelKey: "nav.overview" },
  { href: "/dashboard/finance/", labelKey: "nav.finance" },
  { href: "/dashboard/productivity/", labelKey: "nav.productivity" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard/") return pathname === "/dashboard" || pathname === "/dashboard/";
  return pathname.startsWith(href.replace(/\/$/, ""));
}

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
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              orientation === "rail"
                ? `rounded-md px-3 py-2 font-display text-sm tracking-wide transition-colors ${
                    active
                      ? "bg-hull text-signal"
                      : "text-instrument/70 hover:bg-hull/60 hover:text-instrument"
                  }`
                : `rounded-md px-3 py-2 font-display text-xs tracking-wide ${
                    active ? "text-signal" : "text-instrument/70"
                  }`
            }
          >
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
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 border-r border-hull md:block">
          <div className="px-4 pb-2 pt-5 font-display text-lg font-semibold tracking-wide">
            Control <span className="text-signal">Deck</span>
          </div>
          <NavLinks orientation="rail" />
          <div className="p-3">
            <button
              type="button"
              onClick={logout}
              className="w-full rounded-md border border-hull px-3 py-2 font-display text-sm text-instrument/70 transition-colors hover:border-alert hover:text-alert"
            >
              {t("nav.signOut")}
            </button>
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
