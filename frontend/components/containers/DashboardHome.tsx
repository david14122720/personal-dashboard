"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { useSWRConfig } from "swr";
import AppShell from "@/components/layout/AppShell";
import EmptyState from "@/components/ui/EmptyState";
import MetricCard from "@/components/ui/MetricCard";
import TelemetryStrip, { type TelemetryItem } from "@/components/ui/TelemetryStrip";
import WidgetToggle from "@/components/ui/WidgetToggle";
import NotificationBell from "@/components/notifications/NotificationBell";
import ActiveSubs from "@/components/dashboard/widgets/ActiveSubs";
import GoalProgress from "@/components/dashboard/widgets/GoalProgress";
import PendingDebts from "@/components/dashboard/widgets/PendingDebts";
import PendingTasks from "@/components/dashboard/widgets/PendingTasks";
import UpcomingEvents from "@/components/dashboard/widgets/UpcomingEvents";
import UpcomingPayments from "@/components/dashboard/widgets/UpcomingPayments";
import {
  buildNextLayout,
  isWidgetVisible,
  resolveDashboardLayout,
  useAccounts,
  useHabitsToday,
  useMonthlyFlow,
  useNetWorth,
  usePreferences,
  useSpendByCategory,
  useUpdateLayout,
  type DashboardLayout,
} from "@/lib/api/dashboard";
import { formatMoney, toNumber } from "@/lib/api/money";
import { t } from "@/lib/i18n";
import {
  currentMonthKey,
  longestStreak,
  monthBalance,
  monthsAgoStart,
  savingsRate,
  toDonutSlices,
  toFlowPoints,
  toISODate,
  toMonthSummary,
  worstAlertLevel,
} from "@/lib/dashboard/transforms";
import { usePrefersReducedMotion } from "@/lib/dashboard/useReducedMotion";

/**
 * Dashboard home container. Owns all SWR reads (fired in parallel) and
 * coercion at the boundary; `components/ui/*` stay pure. Heavy Recharts
 * wrappers are code-split per route via `next/dynamic` (bundle rule:
 * dynamic imports for heavy components; no barrel files).
 */

const FlowChart = dynamic(() => import("@/components/ui/FlowChart"), {
  ssr: false,
  loading: () => <ChartSkeleton label={t("dashboard.loadingFlow")} />,
});

const CategoryDonut = dynamic(() => import("@/components/ui/CategoryDonut"), {
  ssr: false,
  loading: () => <ChartSkeleton label={t("dashboard.loadingCategory")} />,
});

function ChartSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex h-40 items-center justify-center">
      <p className="text-sm text-instrument/50">{label}…</p>
    </div>
  );
}

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
  const reducedMotion = usePrefersReducedMotion();
  const { mutate } = useSWRConfig();
  const [layoutOverride, setLayoutOverride] = useState<DashboardLayout | null>(null);

  const now = new Date();
  const flowFrom = monthsAgoStart(now, 11);
  const flowTo = toISODate(now);
  const monthStart = `${currentMonthKey(now)}-01`;

  const netWorth = useNetWorth();
  const flow = useMonthlyFlow(flowFrom, flowTo);
  const categories = useSpendByCategory(monthStart, flowTo);
  const habits = useHabitsToday();
  const accounts = useAccounts();
  const prefs = usePreferences();
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

  const telemetryLoading = Boolean(netWorth.isLoading || accounts.isLoading);
  const telemetryError = Boolean(netWorth.error || accounts.error);
  const flowLoading = Boolean(flow.isLoading);
  const flowError = Boolean(flow.error);
  const categoriesLoading = Boolean(categories.isLoading);
  const categoriesError = Boolean(categories.error);
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

  const points = toFlowPoints(flow.data);
  const monthKey = currentMonthKey(now);
  const balance = monthBalance(points, monthKey);
  const current = points.find((p) => p.month === monthKey);
  const rate = current ? savingsRate(current.income, current.expense) : null;

  const cardLed = worstAlertLevel((accounts.data ?? []).map((a) => a.alert_level ?? null));
  const streak = longestStreak(habits.data);

  const strip: TelemetryItem[] = [
    { id: "net-worth", label: t("dashboard.netWorth"), display: fmt(netWorthValue) },
    {
      id: "month-balance",
      label: t("dashboard.monthBalance"),
      display: fmt(balance),
      status: balance >= 0 ? "ok" : "warn",
    },
    {
      id: "savings-rate",
      label: t("dashboard.savingsRate"),
      display: rate === null ? "—" : `${(rate * 100).toFixed(1)}%`,
      status: rate === null ? null : rate >= 0.2 ? "ok" : rate >= 0 ? "warn" : "over",
    },
    { id: "streak", label: t("dashboard.longestStreak"), display: t("dashboard.streakDays", { n: streak }) },
    {
      id: "cards",
      label: t("dashboard.cards"),
      display: cardLed === "none" ? t("dashboard.noCards") : cardLed === "ok" ? t("dashboard.healthy") : cardLed,
      status: cardLed === "none" ? null : cardLed,
    },
  ];

  const slices = toDonutSlices(categories.data);
  const pendingHabits = (habits.data ?? []).filter((h) => h.today_status === "pending");
  const summary = toMonthSummary(flow.data, monthKey);
  const habitsTotal = (habits.data ?? []).length;
  const habitsDone = habitsTotal - pendingHabits.length;
  const habitsPct = habitsTotal === 0 ? null : habitsDone / habitsTotal;

  const customizeRows = [
    { id: "month-income", label: t("dashboard.monthIncome") },
    { id: "month-expense", label: t("dashboard.monthExpense") },
    { id: "month-savings", label: t("dashboard.monthSavings") },
    { id: "upcoming-payments", label: t("dashboard.upcomingPayments") },
    { id: "pending-debts", label: t("dashboard.pendingDebts") },
    { id: "active-subs", label: t("dashboard.activeSubs") },
    { id: "pending-tasks", label: t("dashboard.pendingTasks") },
    { id: "upcoming-events", label: t("dashboard.upcomingEvents") },
    { id: "goal-progress", label: t("dashboard.goalProgress") },
  ];

  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 font-display text-2xl font-semibold tracking-wide">
            {t("dashboard.overviewTitle")}
            <span className="shrink-0 whitespace-nowrap rounded-full border border-signal/20 bg-signal/10 px-2.5 py-0.5 font-mono text-xs font-medium text-signal">
              {t("dashboard.overviewBadge")}
            </span>
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

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label={t("dashboard.netWorth")}
          display={fmt(netWorthValue)}
          hint={worthEntry?.currency}
        />
        <MetricCard
          label={t("dashboard.monthBalance")}
          display={fmt(balance)}
          hint={monthKey}
          status={balance >= 0 ? "ok" : "warn"}
          bar={rate === null ? null : rate * 100}
        />
        <MetricCard
          label={t("dashboard.habitsToday")}
          display={`${habitsDone} / ${habitsTotal}`}
          hint={habitsPct === null ? t("dashboard.allClear") : `${Math.round(habitsPct * 100)}%`}
          status={pendingHabits.length === 0 ? "ok" : "warn"}
          bar={habitsPct === null ? null : habitsPct * 100}
          footer={
            pendingHabits.length === 0
              ? t("habitsDashboard.todayPerfect")
              : t("habitsDashboard.todayMissing", { n: pendingHabits.length })
          }
        />
        <MetricCard
          label={t("dashboard.savingsRate")}
          display={rate === null ? "—" : `${(rate * 100).toFixed(1)}%`}
          hint={monthKey}
          status={rate === null ? null : rate >= 0.2 ? "ok" : rate >= 0 ? "warn" : "over"}
        />
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

      {flowLoading || flowError ? null : (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {visible("month-income") ? (
            <div>
              <div className="mb-2 flex justify-end">
                <WidgetToggle id="month-income" visible onToggle={(v) => toggle("month-income", v)} />
              </div>
              <MetricCard label={t("dashboard.monthIncome")} display={fmt(summary.income)} hint={monthKey} />
            </div>
          ) : null}
          {visible("month-expense") ? (
            <div>
              <div className="mb-2 flex justify-end">
                <WidgetToggle id="month-expense" visible onToggle={(v) => toggle("month-expense", v)} />
              </div>
              <MetricCard label={t("dashboard.monthExpense")} display={fmt(summary.expense)} hint={monthKey} />
            </div>
          ) : null}
          {visible("month-savings") ? (
            <div>
              <div className="mb-2 flex justify-end">
                <WidgetToggle id="month-savings" visible onToggle={(v) => toggle("month-savings", v)} />
              </div>
              <MetricCard
                label={t("dashboard.monthSavings")}
                display={fmt(summary.savings)}
                hint={t("dashboard.monthSavingsHint")}
                status={summary.savings >= 0 ? "ok" : "warn"}
              />
            </div>
          ) : null}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <WidgetShell title={t("dashboard.monthlyFlow")} hint={t("dashboard.monthlyFlowHint")}>
            {flowLoading ? (
              <SectionSkeleton />
            ) : flowError ? (
              <SectionError onRetry={retryDashboards} />
            ) : (
              <FlowChart data={points} animate={!reducedMotion} />
            )}
          </WidgetShell>
        </div>
        <div className="space-y-6 lg:col-span-4">
          <WidgetShell
            title={t("dashboard.spendByCategory")}
            hint={t("dashboard.spendByCategoryHint")}
          >
            {categoriesLoading ? (
              <SectionSkeleton />
            ) : categoriesError ? (
              <SectionError onRetry={retryDashboards} />
            ) : (
              <CategoryDonut data={slices} animate={!reducedMotion} />
            )}
          </WidgetShell>
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
        {visible("pending-debts") ? (
          <WidgetShell
            title={t("dashboard.pendingDebts")}
            hint={t("dashboard.pendingDebtsHint")}
            span="col-span-12 lg:col-span-5"
            action={<WidgetToggle id="pending-debts" visible onToggle={(v) => toggle("pending-debts", v)} />}
          >
            <PendingDebts />
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
