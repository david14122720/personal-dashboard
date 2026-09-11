"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { useSWRConfig } from "swr";
import AppShell from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import { SectionShell } from "@/components/finance/FinanceSections";
import EmptyState from "@/components/ui/EmptyState";
import {
  eventsKey, tasksKey, useEvents as useDashboardEvents, useGoals as useDashboardGoals,
  useMonthlyFlow, useNetWorth, useSavingsGoals, useTasks as useDashboardTasks,
} from "@/lib/api/dashboard";
import { HABITS_TODAY_KEY, habitsHistoryKey, useHabitsHistory, useHabitsToday } from "@/lib/api/productivity";
import { toEventRange } from "@/lib/finance/finance";
import { aggregateEvolution, habitStats } from "@/lib/productivity/habitStats";
import { scoreByArea, type AreaKey } from "@/lib/productivity/scoreByArea";
import { formatMoney, toNumber } from "@/lib/api/money";
import { toUpcomingEvents } from "@/lib/dashboard/transforms";
import { todayYmdLocal } from "@/lib/productivity/productivity";
import { usePrefersReducedMotion } from "@/lib/dashboard/useReducedMotion";

/**
 * S4 progreso: combinado FE-only, ventana fija 30 días. Patrimonio = número de
 * solo lectura (valuaciones INSERT-only, sin escritura). Score solo visual +
 * disclaimer fijo siempre visible (precedente `AnalysisSection`).
 */

const SavingsChart = dynamic(() => import("@/components/ui/SavingsChart"), {
  ssr: false,
  loading: () => <p role="status" aria-label={t("progress.loadingBlock")} className="py-6 text-center text-sm text-instrument/50">{t("common.loading")}</p>,
});

function range30(now: Date): { from: string; to: string } {
  return { from: todayYmdLocal(new Date(now.getTime() - 29 * 86_400_000)), to: todayYmdLocal(now) };
}

/** Ventana propia de la agenda: los `starts_at` de los próximos 14 días (`toUpcomingEvents`). */
function upcomingWindow(now: Date): { from: string; to: string } {
  return {
    from: todayYmdLocal(now),
    to: todayYmdLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14)),
  };
}

/** loading → error → empty → contenido, retry revalida solo sus keys. */
function Block({ loading, error, empty, emptyNode, onRetry, children }: {
  loading: boolean; error: boolean; empty: boolean; emptyNode: ReactNode; onRetry: () => void; children: ReactNode;
}) {
  if (loading) return <p role="status" aria-label={t("progress.loadingBlock")} className="py-6 text-center text-sm text-instrument/50">{t("common.loading")}</p>;
  if (error) {
    return (
      <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-5">
        <h3 className="font-display text-base font-semibold">{t("progress.loadFailed")}</h3>
        <p className="mt-1 text-sm text-instrument/70">{t("progress.loadFailedHint")}</p>
        <button type="button" onClick={onRetry} className="mt-3 rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal">{t("common.retry")}</button>
      </div>
    );
  }
  if (empty) return <>{emptyNode}</>;
  return <>{children}</>;
}

const AREA_LABEL: Record<AreaKey, string> = {
  finance: t("progress.score.finance"), habits: t("progress.score.habits"),
  goals: t("progress.score.goals"), productivity: t("progress.score.productivity"),
};

const inRange = (day: string | null | undefined, from: string, to: string): boolean => {
  if (!day) return false;
  const date = day.slice(0, 10);
  return date >= from && date <= to;
};

export default function ProgressScreens({ now }: { now?: Date }) {
  const ref = now ?? new Date();
  const { from, to } = range30(ref);
  const { mutate } = useSWRConfig();
  const reduced = usePrefersReducedMotion();
  const flow = useMonthlyFlow(from, to);
  const worth = useNetWorth();
  const today = useHabitsToday();
  const history = useHabitsHistory(from, to);
  const goals = useDashboardGoals();
  const savingsGoals = useSavingsGoals();
  const tasks = useDashboardTasks("done");
  // `GET /events` exige RFC 3339 (una fecha desnuda es 422): el período alimenta el
  // score y la ventana propia de próximos 14 días alimenta la agenda.
  const periodEvents = toEventRange({ from, to });
  const nextEvents = toEventRange(upcomingWindow(ref));
  const events = useDashboardEvents(periodEvents.from, periodEvents.to);
  const upcoming = useDashboardEvents(nextEvents.from, nextEvents.to);

  const rows = flow.data ?? [];
  const habits = today.data ?? [];
  const logs = history.data ?? [];
  const goalItems = goals.data ?? [];
  const savingItems = savingsGoals.data ?? [];
  const doneTasks = (tasks.data ?? []).filter((task) => inRange((task as { completed_at?: string | null }).completed_at, from, to));
  const upcomingEvents = toUpcomingEvents(upcoming.data ?? [], ref, 14);

  // Score: inputs ya normalizados 0–100 por sus transforms; `null` = sin datos.
  const last = rows[rows.length - 1];
  const lastIncome = last ? toNumber(last.income) : 0;
  const lastExpense = toNumber(last?.expense);
  const financeScore = rows.length === 0 ? null
    : Math.round(Math.min(100, Math.max(0, ((lastIncome - lastExpense) / (lastIncome || 1)) * 100)) * 10) / 10;
  const compliances = habits.map((h) => habitStats(logs.filter((l) => l.habit_id === h.habit_id), from, to, h.days_of_week).complianceRate);
  const habitsScore = habits.length === 0 || logs.length === 0 ? null
    : Math.round((compliances.reduce((a, b) => a + b, 0) / compliances.length) * 10) / 10;
  const goalPcts = [
    ...goalItems.map((g) => g.progress ?? 0),
    ...savingItems.map((s) => {
      const goal = toNumber(s.goal ?? s.target_amount);
      return goal > 0 ? (toNumber(s.saved ?? s.saved_amount) / goal) * 100 : 0;
    }),
  ];
  const goalsScore = goalPcts.length === 0 ? null : Math.round((goalPcts.reduce((a, b) => a + b, 0) / goalPcts.length) * 10) / 10;
  // Escala visual documentada: 5+ completadas ≈ 100; sin tareas ni eventos → sin datos.
  const noProdData = !tasks.data || !events.data || (doneTasks.length === 0 && upcomingEvents.length === 0 && tasks.data.length === 0 && (events.data ?? []).length === 0);
  const productivityScore = noProdData ? null : Math.min(100, doneTasks.length * 20);
  const scores = scoreByArea({ finance: financeScore, habits: habitsScore, goals: goalsScore, productivity: productivityScore });

  const cop = (worth.data?.per_currency ?? []).find((e) => e.currency === "COP") ?? worth.data?.per_currency[0];
  const statsOf = (id: string, days?: number[]) => habitStats(logs.filter((l) => l.habit_id === id), from, to, days);
  const pending = habits.filter((h) => h.today_status === "pending");
  const evolution = aggregateEvolution(logs, habits.map((h) => ({ id: h.habit_id, name: h.name })), "week");
  const advanced = goalItems.filter((g) => (g.progress ?? 0) > 0);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-wide">{t("progress.title")}</h1>
      <p className="mt-1 text-sm text-instrument/60">{t("progress.subtitle")}</p>
      <section aria-label={t("progress.score.title")} className="mt-6 rounded-xl border border-hull bg-hull/40 p-5">
        <h2 className="font-display text-base font-semibold">{t("progress.score.title")}</h2>
        <p className="mt-1 text-sm text-instrument/60">{t("progress.score.hint")}</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {scores.map((s) => (
            <li key={s.area} className="rounded-lg border border-hull p-3">
              <div className="flex items-center justify-between text-sm">
                <span>{AREA_LABEL[s.area]}</span>
                <span className="font-display">{s.hasData ? `${s.value} %` : t("progress.score.noData")}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-hull" role="progressbar" aria-label={AREA_LABEL[s.area]} aria-valuenow={s.value ?? 0} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-[var(--color-signal)]" style={{ width: `${s.value ?? 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-instrument/60">{t("progress.score.disclaimer")}</p>
      </section>
      <div className="mt-4 grid grid-cols-12 gap-4">
        <SectionShell title={t("progress.finance")} hint={t("progress.financeHint")} span="col-span-12 xl:col-span-6">
          <Block loading={!flow.data && !flow.error} error={!!flow.error} empty={!!flow.data && rows.length === 0}
            emptyNode={<EmptyState title={t("progress.emptyFinance")} hint={t("progress.emptyFinanceHint")} />}
            onRetry={() => void mutate((k) => typeof k === "string" && k.startsWith("dashboard/monthly-flow"))}>
            <dl className="grid grid-cols-3 gap-3">
              {[[t("progress.income"), lastIncome], [t("progress.expense"), lastExpense], [t("progress.savings"), lastIncome - lastExpense]].map(([label, value]) => (
                <div key={label as string} className="rounded-lg border border-hull p-3">
                  <dt className="text-xs text-instrument/60">{label as string}</dt>
                  <dd className="font-display text-base font-semibold">{formatMoney(value as number)}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4">
              <SavingsChart data={rows.map((row) => ({ month: row.month, savings: toNumber(row.income) - toNumber(row.expense) }))} animate={!reduced} />
            </div>
          </Block>
        </SectionShell>
        <SectionShell title={t("progress.netWorth")} hint={t("progress.netWorthHint")} span="col-span-12 xl:col-span-6">
          <Block loading={!worth.data && !worth.error} error={!!worth.error} empty={!!worth.data && !cop}
            emptyNode={<EmptyState title={t("progress.emptyWorth")} hint={t("progress.emptyWorthHint")} />}
            onRetry={() => void mutate("dashboard/net-worth")}>
            {cop ? <p className="font-display text-2xl font-semibold">{formatMoney(toNumber(cop.net_worth))}</p> : null}
          </Block>
        </SectionShell>
        <SectionShell title={t("progress.goals")} hint={t("progress.goalsHint")} span="col-span-12 xl:col-span-6">
          <Block loading={(!goals.data && !goals.error) || (!savingsGoals.data && !savingsGoals.error)} error={!!goals.error || !!savingsGoals.error}
            empty={!!goals.data && !!savingsGoals.data && goalItems.length === 0 && savingItems.length === 0}
            emptyNode={<EmptyState title={t("progress.emptyGoals")} hint={t("progress.emptyGoalsHint")} />}
            onRetry={() => void mutate((k) => k === "dashboard/goals" || k === "dashboard/savings-goals")}>
            <ul className="space-y-2">
              {goalItems.map((g) => (
                <li key={g.id} className="flex items-center justify-between rounded-lg border border-hull p-3 text-sm"><span>{g.name}</span><span className="font-display">{g.progress ?? 0} %</span></li>
              ))}
              {savingItems.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded-lg border border-hull p-3 text-sm"><span>{s.name}</span><span className="font-display">{formatMoney(toNumber(s.saved ?? s.saved_amount))}</span></li>
              ))}
            </ul>
          </Block>
        </SectionShell>
        <SectionShell title={t("progress.habits")} hint={t("progress.habitsHint")} span="col-span-12 xl:col-span-6">
          <Block loading={(!today.data && !today.error) || (!history.data && !history.error)} error={!!today.error || !!history.error}
            empty={!!today.data && !!history.data && habits.length === 0}
            emptyNode={<EmptyState title={t("progress.emptyHabits")} hint={t("progress.emptyHabitsHint")} />}
            onRetry={() => {
              void mutate(HABITS_TODAY_KEY);
              void mutate(habitsHistoryKey(from, to));
            }}>
            <h3 className="font-display text-sm font-medium">{t("progress.pendingHabits")}</h3>
            <ul className="mt-2 space-y-1">{pending.map((h) => (<li key={h.habit_id} className="text-sm"><span>{h.name}</span></li>))}</ul>
            <h3 className="mt-4 font-display text-sm font-medium">{t("progress.bestStreaks")}</h3>
            <ul className="mt-2 space-y-1">{habits.map((h) => (<li key={h.habit_id} className="text-sm"><span>{h.name} · {statsOf(h.habit_id, h.days_of_week).bestStreak}</span></li>))}</ul>
            <h3 className="mt-4 font-display text-sm font-medium">{t("progress.weeklyEvolution")}</h3>
            <ul className="mt-2 space-y-1">{evolution.map((s) => (<li key={s.name} className="text-sm"><span>{s.name} · {s.points.slice(-4).map((p) => `${p.bucket}:${p.done}`).join(" ")}</span></li>))}</ul>
          </Block>
        </SectionShell>
        <SectionShell title={t("progress.productivity")} hint={t("progress.productivityHint")} span="col-span-12">
          <Block loading={(!tasks.data && !tasks.error) || (!upcoming.data && !upcoming.error)} error={!!tasks.error || !!upcoming.error}
            empty={!!tasks.data && !!upcoming.data && doneTasks.length === 0 && upcomingEvents.length === 0 && advanced.length === 0}
            emptyNode={<EmptyState title={t("progress.emptyActivity")} hint={t("progress.emptyActivityHint")} />}
            onRetry={() => void mutate((k) => typeof k === "string" && (k === tasksKey("done", true) || k === eventsKey(periodEvents.from, periodEvents.to, true) || k === eventsKey(nextEvents.from, nextEvents.to, true)))}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <h3 className="font-display text-sm font-medium">{t("progress.completedTasks")} ({doneTasks.length})</h3>
                <ul className="mt-2 space-y-1">{doneTasks.map((task) => (<li key={task.id} className="text-sm"><span>{task.title}</span></li>))}</ul>
              </div>
              <div>
                <h3 className="font-display text-sm font-medium">{t("progress.advancedGoals")} ({advanced.length})</h3>
                <ul className="mt-2 space-y-1">{advanced.map((g) => (<li key={g.id} className="text-sm"><span>{g.name}</span></li>))}</ul>
              </div>
              <div>
                <h3 className="font-display text-sm font-medium">{t("progress.upcomingEvents")} ({upcomingEvents.length})</h3>
                <ul className="mt-2 space-y-1">{upcomingEvents.map((e) => (<li key={e.id} className="text-sm"><span>{e.title}</span></li>))}</ul>
              </div>
            </div>
          </Block>
        </SectionShell>
      </div>
    </div>
  );
}

export function ProgressScreensShell() {
  return (
    <AppShell>
      <ProgressScreens />
    </AppShell>
  );
}
