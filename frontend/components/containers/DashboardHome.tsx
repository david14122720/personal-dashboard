"use client";

import Link from "next/link";
import { useState } from "react";
import { useSWRConfig } from "swr";
import AppShell from "@/components/layout/AppShell";
import EmptyState from "@/components/ui/EmptyState";
import TelemetryStrip, { type TelemetryItem } from "@/components/ui/TelemetryStrip";
import WidgetToggle from "@/components/ui/WidgetToggle";
import NotificationBell from "@/components/notifications/NotificationBell";
import ActiveSubs from "@/components/dashboard/widgets/ActiveSubs";
import GoalProgress from "@/components/dashboard/widgets/GoalProgress";
import MovementsSnapshot from "@/components/dashboard/widgets/MovementsSnapshot";
import PendingTasks from "@/components/dashboard/widgets/PendingTasks";
import UpcomingEvents from "@/components/dashboard/widgets/UpcomingEvents";
import UpcomingPayments from "@/components/dashboard/widgets/UpcomingPayments";
import UpcomingSubs from "@/components/dashboard/widgets/UpcomingSubs";
import {
  buildNextLayout,
  isWidgetVisible,
  resolveDashboardLayout,
  useAccounts,
  useHabitsToday,
  useNetWorth,
  usePreferences,
  useUpdateLayout,
  type DashboardLayout,
} from "@/lib/api/dashboard";
import {
  useSubscriptions as useFinanceSubscriptions,
} from "@/lib/api/finance";
import { formatMoney, toNumber } from "@/lib/api/money";
import { t } from "@/lib/i18n";
import { toMonthlyCost } from "@/lib/dashboard/transforms";
import { toAccountCards, toTotalBalance } from "@/lib/finance/finance";

/**
 * Dashboard home container. Owns all SWR reads (fired in parallel) and
 * coercion at the boundary; `components/ui/*` stay pure. The telemetry
 * strip reads four live sources only (D1): net worth, account count,
 * monthly subscription cost and total balance — no debts, no savings, no
 * flow, budget or category aggregate is queried.
 */

function SectionSkeleton() {
  return (
    <div
      role="status"
      aria-label={t("dashboard.loadingDashboard")}
      className="flex h-40 items-center justify-center rounded-xl border border-hull bg-hull/40"
    >
      <p className="text-sm text-instrument/50">{t("dashboard.loadingDashboard")}…</p>
    </div>
  );
}

function SectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-5">
      <p className="mt-1 text-sm text-instrument/70">{t("dashboard.sectionLoadFailed")}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}

/**
 * Local Stitch panel. `span` stays optional so shells nested in the 8/4
 * column blocks do not need grid placement classes.
 */
function WidgetShell({
  title,
  hint,
  children,
  span,
  action,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  span?: string;
  action?: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={`rounded-xl border border-slate-800/80 bg-[#0f131d]/90 p-5 ${span ?? ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold tracking-wide text-white">{title}</h2>
          {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function DashboardHome() {
  const { mutate } = useSWRConfig();
  const [layoutOverride, setLayoutOverride] = useState<DashboardLayout | null>(null);

  const netWorth = useNetWorth();
  const accounts = useAccounts();
  const habits = useHabitsToday();
  const prefs = usePreferences();
  // Strip-only finance reads (finance/* scope, independent of widget visibility).
  const financeSubs = useFinanceSubscriptions();
  const updateLayout = useUpdateLayout();
  const baseLayout = resolveDashboardLayout(prefs.data);
  const layout = layoutOverride ?? baseLayout;
  const visible = (id: string) => isWidgetVisible(layout, id);
  const toggle = (id: string, v: boolean) => {
    const next = buildNextLayout(layout, id, v);
    setLayoutOverride(next);
    void updateLayout(next);
  };
  const retryDashboards = () =>
    void mutate((key) => typeof key === "string" && key.startsWith("dashboard/"));

  const telemetryLoading = Boolean(
    netWorth.isLoading || accounts.isLoading || financeSubs.isLoading,
  );
  const telemetryError = Boolean(
    netWorth.error || accounts.error || financeSubs.error,
  );
  const habitsLoading = Boolean(habits.isLoading);
  const habitsError = Boolean(habits.error);

  const locale = prefs.data?.preferences.locale ?? "es-CO";
  const currency = prefs.data?.preferences.currency_code ?? "COP";
  const fmt = (value: string | number | null | undefined) =>
    formatMoney(value, { locale, currency });

  const worthEntry =
    netWorth.data?.per_currency.find((e) => e.currency === currency) ??
    netWorth.data?.per_currency[0];
  const netWorthValue = worthEntry ? toNumber(worthEntry.net_worth) : 0;
  // The accounts list endpoint already hides archived rows server-side
  // (`NOT is_archived`), so its length is the non-archived account count.
  const accountsCount = (accounts.data ?? []).length;
  const monthlyCost = toMonthlyCost(financeSubs.data);
  const totalBalance = toTotalBalance(toAccountCards(accounts.data), currency);

  const strip: TelemetryItem[] = [
    { id: "net-worth", label: t("dashboard.netWorth"), display: fmt(netWorthValue) },
    { id: "accounts", label: t("finance.accounts"), display: String(accountsCount) },
    { id: "subscriptions", label: t("finance.subscriptions"), display: fmt(monthlyCost) },
    { id: "total-balance", label: t("dashboard.totalBalance"), display: fmt(totalBalance) },
  ];

  const pendingHabits = (habits.data ?? []).filter((h) => h.today_status === "pending");

  const customizeRows = [
    { id: "upcoming-payments", label: t("dashboard.upcomingPayments") },
    { id: "active-subs", label: t("dashboard.activeSubs") },
    { id: "pending-tasks", label: t("dashboard.pendingTasks") },
    { id: "upcoming-events", label: t("dashboard.upcomingEvents") },
    { id: "goal-progress", label: t("dashboard.goalProgress") },
  ];

  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-wide">
            {t("dashboard.overviewTitle")}
          </h1>
          <p className="mt-1 text-sm text-instrument/60">{t("dashboard.overviewSubtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/finance/"
            className="glow-cyan inline-flex items-center rounded-lg bg-signal px-4 py-2 text-xs font-bold text-deck transition-colors hover:bg-signal-soft"
          >
            {t("dashboard.logActivity")}
          </Link>
          <NotificationBell />
        </div>
      </div>

      <div className="mt-6">
        {telemetryLoading ? (
          <SectionSkeleton />
        ) : telemetryError ? (
          <SectionError onRetry={retryDashboards} />
        ) : (
          <TelemetryStrip items={strip} />
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <WidgetShell
          title={t("dashboard.latestMovementsTitle")}
          hint={t("dashboard.latestMovementsHint")}
          span="col-span-12 lg:col-span-6"
        >
          <MovementsSnapshot />
        </WidgetShell>
        <WidgetShell
          title={t("dashboard.upcomingSubscriptionsTitle")}
          hint={t("dashboard.upcomingSubscriptionsHint")}
          span="col-span-12 lg:col-span-6"
        >
          <UpcomingSubs />
        </WidgetShell>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-4">
          <WidgetShell title={t("dashboard.today")} hint={t("dashboard.todayHint")}>
            {habitsLoading ? (
              <SectionSkeleton />
            ) : habitsError ? (
              <SectionError onRetry={retryDashboards} />
            ) : pendingHabits.length === 0 ? (
              <EmptyState title={t("dashboard.nothingPending")} hint={t("dashboard.allCheckedIn")} />
            ) : (
              <ul className="flex flex-col gap-2">
                {pendingHabits.map((habit) => (
                  <li
                    key={habit.habit_id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-hull px-3 py-2"
                  >
                    <span className="truncate text-sm">{habit.name}</span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-instrument/60">
                      {t("dashboard.habitStreak", { n: habit.current_streak })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </WidgetShell>
        </div>

        {visible("upcoming-payments") ? (
          <WidgetShell
            title={t("dashboard.upcomingPayments")}
            hint={t("dashboard.upcomingPaymentsHint")}
            span="col-span-12 lg:col-span-7"
            action={<WidgetToggle id="upcoming-payments" visible onToggle={(v) => toggle("upcoming-payments", v)} />}
          >
            <UpcomingPayments />
          </WidgetShell>
        ) : null}
        {visible("active-subs") ? (
          <WidgetShell
            title={t("dashboard.activeSubs")}
            hint={t("dashboard.activeSubsHint")}
            span="col-span-12 lg:col-span-5"
            action={<WidgetToggle id="active-subs" visible onToggle={(v) => toggle("active-subs", v)} />}
          >
            <ActiveSubs />
          </WidgetShell>
        ) : null}
        {visible("pending-tasks") ? (
          <WidgetShell
            title={t("dashboard.pendingTasks")}
            hint={t("dashboard.pendingTasksHint")}
            span="col-span-12 lg:col-span-5"
            action={<WidgetToggle id="pending-tasks" visible onToggle={(v) => toggle("pending-tasks", v)} />}
          >
            <PendingTasks />
          </WidgetShell>
        ) : null}
        {visible("upcoming-events") ? (
          <WidgetShell
            title={t("dashboard.upcomingEvents")}
            hint={t("dashboard.upcomingEventsHint")}
            span="col-span-12 lg:col-span-5"
            action={<WidgetToggle id="upcoming-events" visible onToggle={(v) => toggle("upcoming-events", v)} />}
          >
            <UpcomingEvents />
          </WidgetShell>
        ) : null}
        {visible("goal-progress") ? (
          <WidgetShell
            title={t("dashboard.goalProgress")}
            hint={t("dashboard.goalProgressHint")}
            span="col-span-12 lg:col-span-5"
            action={<WidgetToggle id="goal-progress" visible onToggle={(v) => toggle("goal-progress", v)} />}
          >
            <GoalProgress />
          </WidgetShell>
        ) : null}
        <WidgetShell
          title={t("dashboard.customize")}
          hint={t("dashboard.customizeHint")}
          span="col-span-12"
        >
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {customizeRows.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-hull px-3 py-2"
              >
                <span className="truncate text-sm">{row.label}</span>
                <WidgetToggle id={row.id} visible={visible(row.id)} onToggle={(v) => toggle(row.id, v)} />
              </li>
            ))}
          </ul>
        </WidgetShell>
      </div>
    </div>
  );
}

export function DashboardHomeShell() {
  return (
    <AppShell>
      <DashboardHome />
    </AppShell>
  );
}
