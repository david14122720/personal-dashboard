"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import BankAccountsSection from "@/components/settings/BankAccountsSection";
import SubscriptionsSection from "@/components/settings/SubscriptionsSection";
import CustomCategoriesSection from "@/components/settings/CustomCategoriesSection";
import { t } from "@/lib/i18n";
import { getToken } from "@/lib/api/client";

/** Configuración hub (P5 + P6): cuentas bancarias, categorías propias y sesiones. */
export default function AjustesPage() {
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login/");
    }
  }, [router]);

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header>
          <h1 className="font-display text-2xl font-semibold tracking-wide">{t("settings.title")}</h1>
          <p className="mt-1 text-sm text-instrument/70">{t("settings.subtitle")}</p>
        </header>
        <Link
          href="/dashboard/ajustes/sesiones/"
          className="block rounded-xl border border-slate-800/80 bg-[#0f131d]/90 p-5 transition-colors hover:border-signal/50"
        >
          <h2 className="font-display text-lg font-semibold tracking-wide">
            {t("settings.sessionsTitle")}
          </h2>
          <p className="mt-1 text-sm text-instrument/70">{t("settings.sessionsHint")}</p>
        </Link>
        <BankAccountsSection />
        <SubscriptionsSection />
        <CustomCategoriesSection />
      </div>
    </AppShell>
  );
}
