"use client";

import AppShell from "@/components/layout/AppShell";
import SettingsTabs, { type SettingsTab } from "@/components/settings/SettingsTabs";
import GeneralSettings from "@/components/settings/GeneralSettings";
import ApiTokensPanel from "@/components/settings/ApiTokensPanel";
import SessionsPanel from "@/components/settings/SessionsPanel";
import { deck } from "@/components/ui/deckStyles";
import { t } from "@/lib/i18n";

/** One Ajustes interface, three routes: the sidebar keeps a single "Ajustes"
 * destination while each tab is linkable and renders the same shell. */
export default function SettingsScreen({ active }: { active: SettingsTab }) {
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header>
          <h1 className={deck.pageTitle}>{t("settings.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("settings.subtitle")}</p>
        </header>
        <SettingsTabs active={active} />
        {active === "general" ? (
          <GeneralSettings />
        ) : active === "tokens" ? (
          <ApiTokensPanel />
        ) : (
          <SessionsPanel />
        )}
      </div>
    </AppShell>
  );
}
