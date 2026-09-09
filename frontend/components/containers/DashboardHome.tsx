"use client";

import dynamic from "next/dynamic";
import { useSWRConfig } from "swr";
import AppShell from "@/components/layout/AppShell";
import EmptyState from "@/components/ui/EmptyState";
import type { BudgetBarDatum } from "@/components/ui/BudgetBars";
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
  useBudgets,
  useDebts,
  useEvents,
  useGoals,
  useHabitsToday,
  useMonthlyFlow,
  useNetWorth,
  usePreferences,
  useSavingsGoals,
  useSpendByCategory,
  useSubscriptions,
  useTasks,
  useUpdateLayout,
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
  worstBudgetStatus,
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

const BudgetBars = dynamic(() => import("@/components/ui/BudgetBars"), {
  ssr: false,
  loading: () => <ChartSkeleton label={t("dashboard.loadingBudgets")} />,
});

function ChartSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex h-40 items-center justify-center">
      <p className="text-sm text-instrument/50">{label}…</p>
    </div>
  );
}

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
  span: string;
  action?: React.ReactNode;
}) {
  return (
    <section aria-label={title} className={`rounded-xl border border-hull bg-hull/40 p-5 ${span}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold tracking-wide">{title}</h2>
          {hint ? <p className="mt-1 text-sm text-instrument/60">{hint}</p> : null}
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

  const now = new Date();
  const flowFrom = monthsAgoStart(now, 11);
  const flowTo = toISODate(now);
  const monthStart = `${currentMonthKey(now)}-01`;

  const netWorth = useNetWorth();
  const flow = useMonthlyFlow(flowFrom, flowTo);
  const categories = useSpendByCategory(monthStart, flowTo);
  const budgets = useBudgets();
  const habits = useHabitsToday();
  const accounts = useAccounts();
  const prefs = usePreferences();
  const updateLayout = useUpdateLayout();
  const layout = resolveDashboardLayout(prefs.data);
  const visible = (id: string) => isWidgetVisible(layout, id);
  const toggle = (id: string, v: boolean) => void updateLayout(buildNextLayout(layout, id, v));
  const debtsQ = useDebts(visible("pending-debts") || visible("upcoming-payments"));
  const subsQ = useSubscriptions(visible("active-subs") || visible("upcoming-payments"));
  const tasksQ = useTasks(null, visible("pending-tasks"));
  const eventsQ = useEvents(null, null, visible("upcoming-events") || visible("upcoming-payments"));
  const goalsQ = useGoals(visible("goal-progress"));
  const savingsQ = useSavingsGoals(visible("goal-progress"));
  const queries = [netWorth, flow, categories, budgets, habits, accounts, prefs, debtsQ, subsQ, tasksQ, eventsQ, goalsQ, savingsQ];
  const isLoading = queries.some((q) => q.isLoading);
  const failed = queries.filter((q) => q.error);

  if (isLoading) {
    return (
      <div role="status" aria-label={t("dashboard.loadingDashboard")} aria-busy="true">
        <h1 className="font-display text-2xl font-semibold tracking-wide">{t("dashboard.overview")}</h1>
        <div className="mt-6 grid grid-cols-12 gap-4">
          {[0, 1, 2].map((n) => (
            <div
              key={n}
              className="col-span-12 animate-pulse rounded-xl border border-hull bg-hull/40 p-5 md:col-span-6 xl:col-span-4"
            >
              <div className="h-4 w-24 rounded bg-hull" />
              <div className="mt-3 h-8 w-32 rounded bg-hull" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (failed.length > 0) {
    return (
      <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-5">
        <h1 className="font-display text-lg font-semibold">{t("dashboard.loadFailed")}</h1>
        <p className="mt-1 text-sm text-instrument/70">
          {t("dashboard.loadFailedDetail", { failed: failed.length, total: queries.length })}
        </p>
        <button
          type="button"
          onClick={() => void mutate((key) => typeof key === "string" && key.startsWith("dashboard/"))}
          className="mt-4 rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

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

  const budgetRows: BudgetBarDatum[] = (budgets.data ?? []).map((b) => ({
    id: b.id,
    label: `${b.currency} ${toNumber(b.amount).toFixed(0)} · ${b.period_start}`,
    pct: Number.isFinite(b.pct) ? b.pct : 0,
    status: b.status,
  }));
  const budgetLed = worstBudgetStatus((budgets.data ?? []).map((b) => b.status));
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
      id: "budgets",
      label: t("dashboard.budgets"),
      display: budgetLed === "none" ? t("dashboard.noBudgets") : budgetLed === "ok" ? t("dashboard.onTrack") : budgetLed,
      status: budgetLed === "none" ? null : budgetLed,
    },
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

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div><h1 className="font-display text-2xl font-semibold tracking-wide">{t("dashboard.overview")}</h1><p className="mt-1 text-sm text-instrument/60">{t("dashboard.overviewSubtitle")}</p></div>
        <NotificationBell />
      </div>
      <div className="mt-6 grid grid-cols-12 gap-4">
        <div className="col-span-12">
          <TelemetryStrip items={strip} />
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-4">
          <MetricCard label={t("dashboard.netWorth")} display={fmt(netWorthValue)} hint={worthEntry?.currency} />
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-4">
          <MetricCard
            label={t("dashboard.monthBalance")}
            display={fmt(balance)}
            hint={monthKey}
            status={balance >= 0 ? "ok" : "warn"}
          />
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-4">
          <MetricCard
            label={t("dashboard.pendingHabits")}
            display={`${pendingHabits.length}`}
            hint={pendingHabits.length === 0 ? t("dashboard.allClear") : t("dashboard.awaitingCheckin")}
            status={pendingHabits.length === 0 ? "ok" : "warn"}
          />
        </div>
        {visible("month-income") ? (
          <div className="col-span-12 md:col-span-6 xl:col-span-4">
            <div className="mb-2 flex justify-end"><WidgetToggle id="month-income" visible onToggle={(v) => toggle("month-income", v)} /></div>
            <MetricCard label={t("dashboard.monthIncome")} display={fmt(summary.income)} hint={monthKey} />
          </div>
        ) : null}
        {visible("month-expense") ? (
          <div className="col-span-12 md:col-span-6 xl:col-span-4">
            <div className="mb-2 flex justify-end"><WidgetToggle id="month-expense" visible onToggle={(v) => toggle("month-expense", v)} /></div>
            <MetricCard label={t("dashboard.monthExpense")} display={fmt(summary.expense)} hint={monthKey} />
          </div>
        ) : null}
        {visible("month-savings") ? (
          <div className="col-span-12 md:col-span-6 xl:col-span-4">
            <div className="mb-2 flex justify-end"><WidgetToggle id="month-savings" visible onToggle={(v) => toggle("month-savings", v)} /></div>
            <MetricCard label={t("dashboard.monthSavings")} display={fmt(summary.savings)} hint={t("dashboard.monthSavingsHint")} status={summary.savings >= 0 ? "ok" : "warn"} />
          </div>
        ) : null}
        {visible("upcoming-payments") ? (<WidgetShell title={t("dashboard.upcomingPayments")} hint={t("dashboard.upcomingPaymentsHint")} span="col-span-12 xl:col-span-7" action={<WidgetToggle id="upcoming-payments" visible onToggle={(v) => toggle("upcoming-payments", v)} />}><UpcomingPayments /></WidgetShell>) : null}
        {visible("pending-debts") ? (<WidgetShell title={t("dashboard.pendingDebts")} hint={t("dashboard.pendingDebtsHint")} span="col-span-12 md:col-span-6 xl:col-span-5" action={<WidgetToggle id="pending-debts" visible onToggle={(v) => toggle("pending-debts", v)} />}><PendingDebts /></WidgetShell>) : null}
        {visible("active-subs") ? (<WidgetShell title={t("dashboard.activeSubs")} hint={t("dashboard.activeSubsHint")} span="col-span-12 md:col-span-6 xl:col-span-5" action={<WidgetToggle id="active-subs" visible onToggle={(v) => toggle("active-subs", v)} />}><ActiveSubs /></WidgetShell>) : null}
        {visible("pending-tasks") ? (<WidgetShell title={t("dashboard.pendingTasks")} hint={t("dashboard.pendingTasksHint")} span="col-span-12 md:col-span-6 xl:col-span-5" action={<WidgetToggle id="pending-tasks" visible onToggle={(v) => toggle("pending-tasks", v)} />}><PendingTasks /></WidgetShell>) : null}
        {visible("upcoming-events") ? (<WidgetShell title={t("dashboard.upcomingEvents")} hint={t("dashboard.upcomingEventsHint")} span="col-span-12 md:col-span-6 xl:col-span-5" action={<WidgetToggle id="upcoming-events" visible onToggle={(v) => toggle("upcoming-events", v)} />}><UpcomingEvents /></WidgetShell>) : null}
        {visible("goal-progress") ? (<WidgetShell title={t("dashboard.goalProgress")} hint={t("dashboard.goalProgressHint")} span="col-span-12 xl:col-span-5" action={<WidgetToggle id="goal-progress" visible onToggle={(v) => toggle("goal-progress", v)} />}><GoalProgress /></WidgetShell>) : null}
        <WidgetShell
          title={t("dashboard.monthlyFlow")}
          hint={t("dashboard.monthlyFlowHint")}
          span="col-span-12 xl:col-span-7"
        >
          <FlowChart data={points} animate={!reducedMotion} />
        </WidgetShell>
        <WidgetShell
          title={t("dashboard.spendByCategory")}
          hint={t("dashboard.spendByCategoryHint")}
          span="col-span-12 xl:col-span-5"
        >
          <CategoryDonut data={slices} animate={!reducedMotion} />
        </WidgetShell>
        <WidgetShell
          title={t("dashboard.budgets")}
          hint={t("dashboard.budgetsHint")}
          span="col-span-12 xl:col-span-7"
        >
          <BudgetBars data={budgetRows} animate={!reducedMotion} />
        </WidgetShell>
        <WidgetShell
          title={t("dashboard.today")}
          hint={t("dashboard.todayHint")}
          span="col-span-12 xl:col-span-5"
        >
          {pendingHabits.length === 0 ? (
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
