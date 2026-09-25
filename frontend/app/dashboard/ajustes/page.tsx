"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import BankAccountsSection from "@/components/settings/BankAccountsSection";
import SubscriptionsSection from "@/components/settings/SubscriptionsSection";
import CustomCategoriesSection from "@/components/settings/CustomCategoriesSection";
import { t } from "@/lib/i18n";
import { getToken } from "@/lib/api/client";

/** Configuración hub (P5 + P6): cuentas bancarias y categorías propias. */
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
        <BankAccountsSection />
        <SubscriptionsSection />
        <CustomCategoriesSection />
      </div>
    </AppShell>
  );
}
