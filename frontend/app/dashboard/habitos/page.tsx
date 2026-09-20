"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import HabitsSection from "@/components/productivity/HabitsSection";
import { t } from "@/lib/i18n";
import { getToken } from "@/lib/api/client";

export default function HabitosPage() {
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login/");
    }
  }, [router]);

  return (
    <AppShell>
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-wide">{t("nav.habits")}</h1>
        <p className="mt-1 text-sm text-instrument/60">{t("productivity.tracker.hint")}</p>
        <div className="mt-6">
          <HabitsSection />
        </div>
      </div>
    </AppShell>
  );
}
