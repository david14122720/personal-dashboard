"use client";

import HabitsTrackerGrid from "@/components/productivity/HabitsTrackerGrid";
import { t } from "@/lib/i18n";
import { useHabitsToday } from "@/lib/api/productivity";

/**
 * Single-owner shell for the standalone habits page (`/dashboard/habitos/`).
 * Owns the `useHabitsToday` read (loading + error + retry); the grid keeps
 * owning the month range logs (`useHabitsHistory`) and the today-log action.
 */
export default function HabitsSection() {
  const habits = useHabitsToday();

  if (habits.isLoading) {
    return (
      <p role="status" aria-busy="true" className="text-sm text-instrument/60">
        {t("common.loading")}
      </p>
    );
  }

  if (habits.error) {
    return (
      <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-5">
        <h2 className="font-display text-lg font-semibold">{t("productivity.tracker.loadFailed")}</h2>
        <button
          type="button"
          onClick={() => void habits.mutate()}
          className="mt-4 rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  return <HabitsTrackerGrid habits={habits.data ?? []} />;
}
