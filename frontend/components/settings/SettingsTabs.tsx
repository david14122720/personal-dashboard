"use client";

import Link from "next/link";
import { t, type EsKey } from "@/lib/i18n";

/** The three tabs of the unified Ajustes hub. Each tab is a route of the same
 * interface (General, Tokens, Sesiones), so deep links and old bookmarks keep
 * working while the sidebar exposes a single "Ajustes" destination. */
export type SettingsTab = "general" | "tokens" | "sessions";

const TABS: { id: SettingsTab; href: string; labelKey: EsKey }[] = [
  { id: "general", href: "/dashboard/ajustes/", labelKey: "settings.tabGeneral" },
  { id: "tokens", href: "/dashboard/ajustes/tokens/", labelKey: "tokens.title" },
  { id: "sessions", href: "/dashboard/ajustes/sesiones/", labelKey: "settings.tabSessions" },
];

const TAB_ACTIVE =
  "border-sky-500/30 bg-sky-500/10 font-medium text-instrument";
const TAB_IDLE =
  "border-transparent font-medium text-slate-400 hover:bg-card hover:text-instrument";

export default function SettingsTabs({ active }: { active: SettingsTab }) {
  return (
    <nav
      aria-label={t("settings.tabsLabel")}
      className="flex flex-wrap items-center gap-1 rounded-lg border border-hair bg-panel p-1"
    >
      {TABS.map((tab) => {
        const current = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={`flex min-h-[44px] flex-1 items-center justify-center whitespace-nowrap rounded-md border px-2 py-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-signal sm:px-3 sm:text-sm ${
              current ? TAB_ACTIVE : TAB_IDLE
            }`}
          >
            {t(tab.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
