"use client";

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { useSWRConfig } from "swr";
import AppShell from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import PeriodSelector from "@/components/finance/PeriodSelector";
import { SectionShell } from "@/components/finance/FinanceSections";
import EmptyState from "@/components/ui/EmptyState";
import { toEventRange, toPeriodRange, type PeriodSel } from "@/lib/finance/finance";
import {
  eventsKey,
  tasksKey,
  useEvents as useDashboardEvents,
  useGoals as useDashboardGoals,
  useMonthlyFlow,
  useSpendByCategory,
  useTasks as useDashboardTasks,
} from "@/lib/api/dashboard";
import { GOALS_KEY, HABITS_TODAY_KEY, habitsHistoryKey, useHabitsHistory, useHabitsToday } from "@/lib/api/productivity";
import { habitStats } from "@/lib/productivity/habitStats";
import { formatMoney, toNumber } from "@/lib/api/money";
import { usePrefersReducedMotion } from "@/lib/dashboard/useReducedMotion";

/**
 * S3 reportes: pantalla FE-only. Un `PeriodSelector` gobierna los 4 bloques
 * (finanzas, hábitos, metas, actividad) sobre endpoints existentes en
 * paralelo; cero endpoints nuevos y sin exportar archivos. Cada bloque
 * aísla loading/error/empty con retry que revalida solo sus keys.
 */

const SavingsChart = dynamic(() => import("@/components/ui/SavingsChart"), {
  ssr: false,
  loading: () => <BlockLoading />,
});

type Range = { from: string; to: string } | null;

function BlockLoading() {
  return (
    <div role="status" aria-label={t("reports.loadingBlock")} className="py-6 text-center">
      <p className="text-sm text-instrument/50">{t("common.loading")}</p>
    </div>
  );
}

function BlockError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-5">
      <h3 className="font-display text-base font-semibold">{t("reports.loadFailed")}</h3>
      <p className="mt-1 text-sm text-instrument/70">{t("reports.loadFailedHint")}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}

/** Estado independiente por bloque: loading → error → empty → contenido. */
function BlockShell({
  loading,
  error,
  empty,
  emptyNode,
  onRetry,
  children,
}: {
  loading: boolean;
  error: boolean;
  empty: boolean;
  emptyNode: ReactNode;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (loading) return <BlockLoading />;
  if (error) return <BlockError onRetry={onRetry} />;
  if (empty) return <>{emptyNode}</>;
  return <>{children}</>;
}

function FinanceBlock({ range }: { range: Range }) {
  const { mutate } = useSWRConfig();
  const reduced = usePrefersReducedMotion();
  const flow = useMonthlyFlow(range?.from ?? null, range?.to ?? null);
  const cats = useSpendByCategory(range?.from ?? null, range?.to ?? null, "expense");
  const rows = flow.data ?? [];
  const categories = cats.data ?? [];
  const income = rows.reduce((acc, row) => acc + toNumber(row.income), 0);
  const expense = rows.reduce((acc, row) => acc + toNumber(row.expense), 0);
  return (
    <BlockShell
      loading={!!range && ((!flow.data && !flow.error) || (!cats.data && !cats.error))}
      error={!!range && (!!flow.error || !!cats.error)}
      empty={!range || (!!flow.data && !!cats.data && rows.length === 0 && categories.length === 0)}
      emptyNode={<EmptyState title={t("reports.emptyFinance")} hint={t("reports.emptyFinanceHint")} />}
      onRetry={() =>
        void mutate(
          (key) =>
            typeof key === "string" &&
            (key.startsWith("dashboard/monthly-flow") || key.startsWith("dashboard/by-category")),
        )
      }
    >
      <dl className="grid grid-cols-3 gap-3">
        {[
          [t("reports.income"), income],
          [t("reports.expense"), expense],
          [t("reports.savings"), income - expense],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-lg border border-hull p-3">
            <dt className="text-xs text-instrument/60">{label as string}</dt>
            <dd className="font-display text-base font-semibold">{formatMoney(value as number)}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-4 font-display text-sm font-medium">{t("reports.topCategories")}</h3>
      <ul className="mt-2 space-y-1">
        {categories.map((cat) => (
          <li key={cat.category_id} className="flex items-center justify-between text-sm">
            <span>{cat.name}</span>
            <span className="font-display">{formatMoney(toNumber(cat.total))}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <SavingsChart
          data={rows.map((row) => ({ month: row.month, savings: toNumber(row.income) - toNumber(row.expense) }))}
          animate={!reduced}
        />
      </div>
    </BlockShell>
  );
}

function HabitsBlock({ range }: { range: Range }) {
  const { mutate } = useSWRConfig();
  const today = useHabitsToday();
  const history = useHabitsHistory(range?.from ?? null, range?.to ?? null);
  const habits = today.data ?? [];
  const logs = history.data ?? [];
  return (
    <BlockShell
      loading={!!range && ((!today.data && !today.error) || (!history.data && !history.error))}
      error={!!range && (!!today.error || !!history.error)}
      empty={!range || (!!today.data && !!history.data && (habits.length === 0 || logs.length === 0))}
      emptyNode={<EmptyState title={t("reports.emptyHabits")} hint={t("reports.emptyHabitsHint")} />}
      onRetry={() => {
        void mutate(HABITS_TODAY_KEY);
        void mutate(habitsHistoryKey(range?.from ?? null, range?.to ?? null));
      }}
    >
      <ul className="space-y-2">
        {habits.map((habit) => {
          const stats = range
            ? habitStats(
                logs.filter((l) => l.habit_id === habit.habit_id),
                range.from,
                range.to,
                habit.days_of_week,
              )
            : { complianceRate: 0, done: 0, missed: 0, unlogged: 0 };
          return (
            <li key={habit.habit_id} className="flex items-center justify-between rounded-lg border border-hull p-3 text-sm">
              <span>{habit.name}</span>
              <span className="font-display">
                {stats.complianceRate} % · {stats.done}/{stats.done + stats.missed + stats.unlogged}
              </span>
            </li>
          );
        })}
      </ul>
    </BlockShell>
  );
}

function GoalsBlock({ range }: { range: Range }) {
  const { mutate } = useSWRConfig();
  const goals = useDashboardGoals(range !== null);
  const items = goals.data ?? [];
  return (
    <BlockShell
      loading={!!range && !goals.data && !goals.error}
      error={!!range && !!goals.error}
      empty={!range || (!!goals.data && items.length === 0)}
      emptyNode={<EmptyState title={t("reports.emptyGoals")} hint={t("reports.emptyGoalsHint")} />}
      onRetry={() => void mutate(GOALS_KEY)}
    >
      <ul className="space-y-2">
        {items.map((goal) => (
          <li key={goal.id} className="rounded-lg border border-hull p-3 text-sm">
            <div className="flex items-center justify-between">
              <span>{goal.name}</span>
              <span className="font-display">{goal.progress ?? 0} %</span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-hull"
              role="progressbar"
              aria-valuenow={goal.progress ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full rounded-full bg-[var(--color-signal)]" style={{ width: `${goal.progress ?? 0}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </BlockShell>
  );
}

function inRange(day: string | null | undefined, range: { from: string; to: string }): boolean {
  if (!day) return false;
  const date = day.slice(0, 10);
  return date >= range.from && date <= range.to;
}

/**
 * Solape real de un evento con el período: el servidor devuelve `starts_at < to`
 * AND `ends_at > from`, así que un evento multi-día que empieza antes del rango
 * igual cuenta. Filtrar solo por `starts_at` lo descartaba.
 */
function overlapsRange(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  range: { from: string; to: string },
): boolean {
  if (!startsAt) return false;
  const starts = startsAt.slice(0, 10);
  const ends = (endsAt ?? startsAt).slice(0, 10);
  return starts <= range.to && ends >= range.from;
}

function ActivityBlock({ range }: { range: Range }) {
  const { mutate } = useSWRConfig();
  const tasks = useDashboardTasks("done", range !== null);
  const eventRange = range ? toEventRange(range) : null;
  const events = useDashboardEvents(eventRange?.from ?? null, eventRange?.to ?? null, range !== null);
  const doneTasks = (tasks.data ?? []).filter(
    (task) => range && inRange((task as { completed_at?: string | null }).completed_at, range),
  );
  const periodEvents = (events.data ?? []).filter(
    (event) => range && overlapsRange(event.starts_at, event.ends_at, range),
  );
  const tasksKeyStr = tasksKey("done", true);
  const eventsKeyStr = eventRange ? eventsKey(eventRange.from, eventRange.to, true) : null;
  return (
    <BlockShell
      loading={!!range && ((!tasks.data && !tasks.error) || (!events.data && !events.error))}
      error={!!range && (!!tasks.error || !!events.error)}
      empty={!range || (!!tasks.data && !!events.data && doneTasks.length === 0 && periodEvents.length === 0)}
      emptyNode={<EmptyState title={t("reports.emptyActivity")} hint={t("reports.emptyActivityHint")} />}
      onRetry={() => void mutate((key) => typeof key === "string" && (key === tasksKeyStr || key === eventsKeyStr))}
    >
      <div className="space-y-4">
        <div>
          <h3 className="font-display text-sm font-medium">{t("reports.completedTasks")}</h3>
          <ul className="mt-2 space-y-1">
            {doneTasks.map((task) => (
              <li key={task.id} className="text-sm">
                <span>{task.title}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-display text-sm font-medium">{t("reports.periodEvents")}</h3>
          <ul className="mt-2 space-y-1">
            {periodEvents.map((event) => (
              <li key={event.id} className="text-sm">
                <span>{event.title}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </BlockShell>
  );
}

export default function ReportsScreens({ now }: { now?: Date }) {
  const [period, setPeriod] = useState<PeriodSel>({ kind: "month" });
  const ref = now ?? new Date();
  let range: Range = null;
  try {
    range = toPeriodRange(period, ref);
  } catch {
    range = null;
  }
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-wide">{t("reports.title")}</h1>
      <p className="mt-1 text-sm text-instrument/60">{t("reports.subtitle")}</p>
      <section aria-label={t("reports.period")} className="mt-6 rounded-xl border border-hull bg-hull/40 p-5">
        <PeriodSelector value={period} onChange={setPeriod} now={ref} />
      </section>
      <div className="mt-4 grid grid-cols-12 gap-4">
        <SectionShell title={t("reports.finance")} hint={t("reports.financeHint")} span="col-span-12 xl:col-span-6">
          <FinanceBlock range={range} />
        </SectionShell>
        <SectionShell title={t("reports.habits")} hint={t("reports.habitsHint")} span="col-span-12 xl:col-span-6">
          <HabitsBlock range={range} />
        </SectionShell>
        <SectionShell title={t("reports.goals")} hint={t("reports.goalsHint")} span="col-span-12 xl:col-span-6">
          <GoalsBlock range={range} />
        </SectionShell>
        <SectionShell title={t("reports.activity")} hint={t("reports.activityHint")} span="col-span-12 xl:col-span-6">
          <ActivityBlock range={range} />
        </SectionShell>
      </div>
    </div>
  );
}

export function ReportsScreensShell() {
  return (
    <AppShell>
      <ReportsScreens />
    </AppShell>
  );
}
