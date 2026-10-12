"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import AppShell from "@/components/layout/AppShell";
import WidgetToggle from "@/components/ui/WidgetToggle";
import DashboardKpis from "@/components/dashboard/DashboardKpis";
import DeckCard from "@/components/dashboard/DeckCard";
import { SectionError, SectionSkeleton } from "@/components/dashboard/SectionStates";
import ExpensePieSection from "@/components/dashboard/ExpensePieSection";
import TotalTrendSection from "@/components/dashboard/TotalTrendSection";
import GoalProgress from "@/components/dashboard/widgets/GoalProgress";
import MovementsSnapshot from "@/components/dashboard/widgets/MovementsSnapshot";
import PendingTasks from "@/components/dashboard/widgets/PendingTasks";
import TodayHabits from "@/components/dashboard/widgets/TodayHabits";
import UpcomingEvents from "@/components/dashboard/widgets/UpcomingEvents";
import UpcomingPayments from "@/components/dashboard/widgets/UpcomingPayments";
import UpcomingSubs from "@/components/dashboard/widgets/UpcomingSubs";
import { deck } from "@/components/ui/deckStyles";
import {
  buildNextLayout,
  isWidgetVisible,
  resolveDashboardLayout,
  useAccounts,
  useHabitsToday,
  usePreferences,
  useUpdateLayout,
  type DashboardLayout,
} from "@/lib/api/dashboard";
import {
  useCategories,
  useMovements,
  useSubscriptions as useFinanceSubscriptions,
} from "@/lib/api/finance";
import { formatMoney, toNumber } from "@/lib/api/money";
import { t } from "@/lib/i18n";
import { toMonthlyCost } from "@/lib/dashboard/transforms";
import {
  currentPeriodRange,
  formatMovementDate,
  isPaidThisCycle,
  toAccountCards,
  toExpenseByCategory,
  toTotalBalance,
  todayInBogota,
} from "@/lib/finance/finance";

/**
 * Dashboard home container. Home-level SWR reads fire in parallel and coercion
 * happens at the boundary; `components/ui/*` stay pure. The four KPI tiles read
 * the same `finance/*` and `dashboard/*` keys the sections below already use
 * (accounts, preferences, subscriptions, movements, categories, habits): no
 * aggregate endpoint, no write path. The two movement chart sections keep their
 * lazily mounted panels, and the app-only widgets (tareas, eventos, metas,
 * personalizar) stay below the design's six cards so nothing was removed.
 */

/** Honest sub-header pill: it only claims live sync when every page read
 * finished without error. */

export default function DashboardHome() {
  const { mutate } = useSWRConfig();
  const [layoutOverride, setLayoutOverride] = useState<DashboardLayout | null>(null);
  // Render the mobile status-row date after mount so the statically exported
  // HTML never disagrees with the client clock (same rule as the shell pill).
  const [todayLabel, setTodayLabel] = useState("");
  useEffect(() => {
    setTodayLabel(formatMovementDate(todayInBogota()));
  }, []);

  const accounts = useAccounts();
  const habits = useHabitsToday();
  const prefs = usePreferences();
  // KPI-only finance reads (same SWR keys as the chart sections below).
  const financeSubs = useFinanceSubscriptions();
  const movements = useMovements();
  const categories = useCategories();
  const updateLayout = useUpdateLayout();
  const baseLayout = resolveDashboardLayout(prefs.data);
  const layout = layoutOverride ?? baseLayout;
  const visible = (id: string) => isWidgetVisible(layout, id);
  const toggle = (id: string, v: boolean) => {
    const next = buildNextLayout(layout, id, v);
    setLayoutOverride(next);
    void updateLayout(next);
  };
  /** Every read whose failure puts the KPI row in its error state:
   * `useAccounts` (`dashboard/accounts`), `usePreferences` (`dashboard/me`)
   * and `useSubscriptions` (`finance/subscriptions`). The row's `Reintentar`
   * revalidates exactly these — a prefix walk over `dashboard/` would be a
   * no-op for a failed subscriptions read (JD item 6). */
  const retryKpiRow = () => {
    void mutate("dashboard/accounts");
    void mutate("dashboard/me");
    void mutate("finance/subscriptions");
  };


  const kpiLoading = Boolean(accounts.isLoading || financeSubs.isLoading || prefs.isLoading);
  const kpiError = Boolean(accounts.error || financeSubs.error || prefs.error);

  const locale = prefs.data?.preferences.locale ?? "es-CO";
  const currency = prefs.data?.preferences.currency_code ?? "COP";
  const fmt = (value: string | number | null | undefined) =>
    formatMoney(value, { locale, currency });

  // The accounts list endpoint already hides archived rows server-side
  // (`NOT is_archived`), so its length is the non-archived account count.
  const accountsList = accounts.data ?? [];
  const accountNames = accountsList.map((account) => account.name);
  const accountsFooter =
    accountNames.length === 0
      ? t("dashboard.kpiAccountsEmpty")
      : accountNames.length <= 3
        ? accountNames.join(", ")
        : `${accountNames.slice(0, 3).join(", ")} ${t("dashboard.kpiAccountsMore", {
            n: accountNames.length - 3,
          })}`;

  // Same-currency rule as Finanzas: `toMonthlyCost` applies frequency factors
  // only and performs no currency conversion, so a foreign-currency
  // subscription would silently mix currencies into one total. Exclude it and
  // state the exclusion (never convert).
  const subsInCurrency = (financeSubs.data ?? []).filter((sub) => sub.currency === currency);
  const excludedSubs = (financeSubs.data ?? []).length - subsInCurrency.length;
  const monthlyCost = toMonthlyCost(subsInCurrency);
  const today = todayInBogota();
  const pendingCharges = (financeSubs.data ?? []).filter(
    (sub) =>
      sub.is_active === true &&
      sub.next_billing_on !== null &&
      sub.next_billing_on !== undefined &&
      !isPaidThisCycle(
        { last_paid_on: sub.last_paid_on ?? null, next_billing_on: sub.next_billing_on },
        today,
      ),
  ).length;
  const subsPendingCopy =
    pendingCharges === 0
      ? t("dashboard.kpiSubsNone")
      : pendingCharges === 1
        ? t("dashboard.kpiSubsPendingOne")
        : t("dashboard.kpiSubsPending", { n: pendingCharges });
  const subsFooter =
    excludedSubs > 0
      ? `${subsPendingCopy} · ${t("dashboard.kpiBalanceExcluded", { n: excludedSubs })}`
      : subsPendingCopy;

  const accountCards = toAccountCards(accounts.data);
  const totalBalance = toTotalBalance(accountCards, currency);
  const excludedAccounts = accountCards.filter((account) => account.currency !== currency).length;
  const balanceFooter =
    excludedAccounts > 0
      ? `${t("dashboard.kpiBalanceFooter", { currency })} · ${t("dashboard.kpiBalanceExcluded", {
          n: excludedAccounts,
        })}`
      : t("dashboard.kpiBalanceFooter", { currency });

  // Current-cycle spend (natural month, same window the chart defaults to) over
  // same-currency accounts only; the chips are the real categories, truncated
  // to two plus an honest `+N más` marker so the decomposition never silently
  // drops a real category (the KPI keeps summing all of them).
  const cycleRange = currentPeriodRange("month");
  const currencyByAccountId = new Map(
    (accounts.data ?? []).map((account) => [account.id, account.currency]),
  );
  const cycleSpend = (movements.data ?? []).reduce((sum, movement) => {
    if (movement.direction !== "expense") return sum;
    if (currencyByAccountId.get(movement.account_id) !== currency) return sum;
    if (movement.occurred_on < cycleRange.from || movement.occurred_on > cycleRange.to) return sum;
    return sum + toNumber(movement.amount);
  }, 0);
  const cycleSlices = toExpenseByCategory(movements.data, {
    range: cycleRange,
    categories: categories.data,
    currencyByAccountId,
    userCurrency: currency,
  });
  const cycleChips = cycleSlices
    .slice(0, 2)
    .map((slice) => t("dashboard.kpiCycleChip", { name: slice.name, amount: fmt(slice.value) }));
  const hiddenCycleChips = Math.max(0, cycleSlices.length - cycleChips.length);
  const cycleTone: "ok" | "empty" | "loading" | "error" = movements.error
    ? "error"
    : movements.isLoading
      ? "loading"
      : cycleSpend === 0
        ? "empty"
        : "ok";
  const cycleFooter =
    cycleTone === "error"
      ? t("dashboard.kpiCycleSpendUnavailable")
      : cycleTone === "loading"
        ? t("common.loading")
        : cycleTone === "empty"
          ? t("dashboard.kpiCycleSpendEmpty")
          : cycleChips.length > 0
            ? hiddenCycleChips > 0
              ? `${cycleChips.join(" + ")} ${t("dashboard.kpiCycleMore", { n: hiddenCycleChips })}`
              : cycleChips.join(" + ")
            : t("dashboard.kpiCycleSpendUncategorized");

  const customizeRows = [
    { id: "upcoming-payments", label: t("dashboard.upcomingPayments") },
    { id: "pending-tasks", label: t("dashboard.pendingTasks") },
    { id: "upcoming-events", label: t("dashboard.upcomingEvents") },
    { id: "goal-progress", label: t("dashboard.goalProgress") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        {/* Mobile prototype status row (`dashboard-mobile.html:7`): sync pill +
            real Bogotá date. The date stays out of the desktop branch (`md:hidden`)
            because the shell's topbar date pill is the desktop affordance. */}
        <div className="flex items-center justify-between gap-3 md:order-2 md:justify-end">
          <p className="text-xs text-muted md:hidden">{todayLabel}</p>
        </div>
        <div className="flex items-start justify-between gap-3 md:order-1 md:w-full">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-instrument">
              {t("dashboard.overviewTitle")}
            </h1>
            <p className="mt-0.5 text-sm text-muted">{t("dashboard.overviewSubtitle")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/dashboard/finance/"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-signal px-4 font-display text-sm font-semibold text-deck transition-colors hover:bg-signal-soft"
            >
              {t("dashboard.logActivity")}
            </Link>
          </div>
        </div>
      </section>

      {kpiLoading ? (
        <SectionSkeleton />
      ) : kpiError ? (
        <SectionError onRetry={retryKpiRow} />
      ) : (
        <DashboardKpis
          accounts={{
            count: String(accountsList.length),
            unit: t("dashboard.kpiAccountsUnit"),
            footer: accountsFooter,
          }}
          subscriptions={{
            display: fmt(monthlyCost),
            currency,
            footer: subsFooter,
          }}
          balance={{ display: fmt(totalBalance), footer: balanceFooter }}
          cycleSpend={{
            display: cycleTone === "error" || cycleTone === "loading" ? "—" : fmt(cycleSpend),
            currency: prefs.data?.preferences.currency_code ?? "COP",
            footer: cycleFooter,
            tone: cycleTone,
          }}
        />
      )}

      {/* Design order (dashboard-mobile.html): chart, donut, movements, habits,
          subscriptions, payments. The column wrappers become `display:contents`
          below `lg`, so the `order-*` classes of each card drive that single
          stack; from `lg` the wrappers are the two independent 7/5 columns. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start lg:gap-6">
        <div className="max-lg:contents lg:col-span-7 lg:space-y-6">
          <TotalTrendSection className="order-1" />
          <MovementsSnapshot className="order-3" />
          <TodayHabits className="order-4" />
        </div>
        <div className="max-lg:contents lg:col-span-5 lg:space-y-6">
          <ExpensePieSection className="order-2" />
          <UpcomingSubs className="order-5" />
          {visible("upcoming-payments") ? (
            <UpcomingPayments
              className="order-6"
              action={
                <WidgetToggle
                  id="upcoming-payments"
                  visible
                  onToggle={(v) => toggle("upcoming-payments", v)}
                />
              }
            />
          ) : null}
        </div>
      </div>

      {/* App-only widgets the design does not have. They keep their real
          visibility switches and are grouped below the design's six cards. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {visible("pending-tasks") ? (
          <DeckCard
            title={t("dashboard.pendingTasks")}
            hint={t("dashboard.pendingTasksHint")}
            className="col-span-12 lg:col-span-5"
            action={
              <WidgetToggle
                id="pending-tasks"
                visible
                onToggle={(v) => toggle("pending-tasks", v)}
              />
            }
          >
            <PendingTasks />
          </DeckCard>
        ) : null}
        {visible("upcoming-events") ? (
          <DeckCard
            title={t("dashboard.upcomingEvents")}
            hint={t("dashboard.upcomingEventsHint")}
            className="col-span-12 lg:col-span-5"
            action={
              <WidgetToggle
                id="upcoming-events"
                visible
                onToggle={(v) => toggle("upcoming-events", v)}
              />
            }
          >
            <UpcomingEvents />
          </DeckCard>
        ) : null}
        {visible("goal-progress") ? (
          <DeckCard
            title={t("dashboard.goalProgress")}
            hint={t("dashboard.goalProgressHint")}
            className="col-span-12 lg:col-span-5"
            action={
              <WidgetToggle
                id="goal-progress"
                visible
                onToggle={(v) => toggle("goal-progress", v)}
              />
            }
          >
            <GoalProgress />
          </DeckCard>
        ) : null}
        <DeckCard
          title={t("dashboard.customize")}
          hint={t("dashboard.customizeHint")}
          className="col-span-12"
        >
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {customizeRows.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-hair px-3 py-2"
              >
                <span className="truncate text-sm">{row.label}</span>
                <WidgetToggle id={row.id} visible={visible(row.id)} onToggle={(v) => toggle(row.id, v)} />
              </li>
            ))}
          </ul>
        </DeckCard>
      </div>

      <footer className="border-t border-hair py-5 text-center text-xs text-faint">
        <p>{t("dashboard.footerLine")}</p>
      </footer>
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
