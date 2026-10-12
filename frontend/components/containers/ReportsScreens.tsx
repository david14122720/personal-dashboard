"use client";

import { useState, type ReactNode } from "react";
import { useSWRConfig } from "swr";
import AppShell from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import PeriodSelector from "@/components/finance/PeriodSelector";
import DeckCard, { DeckEmptyState } from "@/components/dashboard/DeckCard";
import { BalanceIcon, SubscriptionsIcon } from "@/components/dashboard/icons";
import KpiTile from "@/components/ui/KpiTile";
import { deck } from "@/components/ui/deckStyles";
import { toEventRange, toPeriodRange, type PeriodSel } from "@/lib/finance/finance";
import {
  eventsKey,
  tasksKey,
  useEvents as useDashboardEvents,
  useGoals as useDashboardGoals,
  useNetWorth,
  useTasks as useDashboardTasks,
} from "@/lib/api/dashboard";
import {
  useSubscriptions as useFinanceSubscriptions,
} from "@/lib/api/finance";
import { GOALS_KEY, HABITS_TODAY_KEY, habitsHistoryKey, useHabitsHistory, useHabitsToday } from "@/lib/api/productivity";
import { habitStats } from "@/lib/productivity/habitStats";
import { formatMoney, toNumber } from "@/lib/api/money";
import {
  toFinanceSnapshot,
  toMonthlyCost,
} from "@/lib/dashboard/transforms";

/**
 * S3 reportes: pantalla FE-only. Un `PeriodSelector` gobierna los bloques
 * por período (hábitos, metas, actividad) sobre endpoints existentes en
 * paralelo; el bloque de finanzas es una foto actual (patrimonio + costo
 * mensual de suscripciones) sin ventana de período.
 * Cero endpoints nuevos y sin exportar archivos. Cada bloque aísla
 * loading/error/empty con retry que revalida solo sus keys.
 *
 * T8c coherence pass (no design source for this route): chrome only, ported to
 * the Control Deck language of `dashboard-desktop.html` — `DeckCard` panels with
 * the hairlined section header, `KpiTile` figures, mono micro-labels, deck rows
 * and the prototype empty state. Same hooks, same numbers, same copy. The period
 * control keeps its own pre-existing markup (`finance/PeriodSelector` is outside
 * this task's edit surface).
 */

type Range = { from: string; to: string } | null;

function BlockLoading() {
  return (
    <div role="status" aria-label={t("reports.loadingBlock")} className="py-6 text-center">
      <p className="text-sm text-faint">{t("common.loading")}</p>
    </div>
  );
}

function BlockError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-4 sm:p-5">
      <h3 className="font-display text-sm font-semibold text-alert-soft">{t("reports.loadFailed")}</h3>
      <p className="mt-1 text-sm text-instrument/70">{t("reports.loadFailedHint")}</p>
      <button
        type="button"
        onClick={onRetry}
        className={`mt-3 ${deck.cardAction}`}
      >
        {t("common.retry")}
      </button>
    </div>
  );
}

/** Decorative glyph of the shared empty state (D3: inline SVG, never an icon font). */
function EmptyGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12h7" />
    </svg>
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

/**
 * Foto actual de finanzas (S-H): patrimonio + costo mensual de
 * suscripciones. No la gobierna el período elegido;
 * lleva la etiqueta `reports.financeCurrent` para no leerse como
 * "este mes". Ninguna petición toca un endpoint agregado eliminado.
 */
function FinanceBlock() {
  const { mutate } = useSWRConfig();
  const worth = useNetWorth();
  const subs = useFinanceSubscriptions();
  const loading = (!worth.data && !worth.error) || (!subs.data && !subs.error);
  const error = Boolean(worth.error || subs.error);
  const cop = (worth.data?.per_currency ?? []).find((e) => e.currency === "COP") ?? worth.data?.per_currency[0];
  const snapshot = toFinanceSnapshot({
    netWorth: cop ? toNumber(cop.net_worth) : 0,
    monthlySubsCost: toMonthlyCost(subs.data),
  });
  const hasData = Boolean(worth.data && subs.data);
  return (
    <BlockShell
      loading={loading}
      error={error}
      empty={!loading && !error && !hasData}
      emptyNode={<DeckEmptyState icon={<EmptyGlyph />} title={t("reports.emptyFinance")} hint={t("reports.emptyFinanceHint")} />}
      onRetry={() =>
        void mutate(
          (key) =>
            typeof key === "string" &&
            (key === "dashboard/net-worth" ||
              key === "finance/subscriptions"),
        )
      }
    >
      <p className={deck.monoMicroLabel}>{t("reports.financeCurrent")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KpiTile
          label={t("dashboard.netWorth")}
          icon={<BalanceIcon className="h-3.5 w-3.5" />}
          signal
          glow="hairline"
          value={formatMoney(snapshot.netWorth)}
          valueClass={deck.kpiValue}
        />
        <KpiTile
          label={t("finance.subscriptions")}
          icon={<SubscriptionsIcon className="h-3.5 w-3.5" />}
          value={formatMoney(snapshot.monthlySubsCost)}
          valueClass={deck.kpiValue}
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
      emptyNode={<DeckEmptyState icon={<EmptyGlyph />} title={t("reports.emptyHabits")} hint={t("reports.emptyHabitsHint")} />}
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
            <li key={habit.habit_id} className={deck.listRow}>
              <span className="min-w-0 truncate text-sm font-semibold text-instrument">{habit.name}</span>
              <span className={deck.cardMetric}>
                {`${stats.complianceRate} % · ${stats.done}/${stats.done + stats.missed + stats.unlogged}`}
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
      emptyNode={<DeckEmptyState icon={<EmptyGlyph />} title={t("reports.emptyGoals")} hint={t("reports.emptyGoalsHint")} />}
      onRetry={() => void mutate(GOALS_KEY)}
    >
      <ul className="space-y-2">
        {items.map((goal) => (
          <li key={goal.id} className={deck.cardRow}>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <span className="min-w-0 truncate text-sm font-semibold text-instrument">{goal.name}</span>
              <span className={deck.cardMetric}>{`${goal.progress ?? 0} %`}</span>
            </div>
            <div className="mt-3">
              <div
                className={deck.cardProgressTrack}
                role="progressbar"
                aria-valuenow={goal.progress ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className={deck.kpiProgressFillSignal} style={{ width: `${goal.progress ?? 0}%` }} />
              </div>
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
      emptyNode={<DeckEmptyState icon={<EmptyGlyph />} title={t("reports.emptyActivity")} hint={t("reports.emptyActivityHint")} />}
      onRetry={() => void mutate((key) => typeof key === "string" && (key === tasksKeyStr || key === eventsKeyStr))}
    >
      <div className="space-y-4">
        <div>
          <h3 className={deck.monoMicroLabel}>{t("reports.completedTasks")}</h3>
          <ul className="space-y-2">
            {doneTasks.map((task) => (
              <li key={task.id} className={deck.statTile}>
                <span className="text-sm text-instrument">{task.title}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className={deck.monoMicroLabel}>{t("reports.periodEvents")}</h3>
          <ul className="space-y-2">
            {periodEvents.map((event) => (
              <li key={event.id} className={deck.statTile}>
                <span className="text-sm text-instrument">{event.title}</span>
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
      <h1 className={deck.pageTitle}>{t("reports.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("reports.subtitle")}</p>
      <section aria-label={t("reports.period")} className={`mt-6 ${deck.panel}`}>
        <PeriodSelector value={period} onChange={setPeriod} now={ref} />
      </section>
      <div className="mt-4 grid grid-cols-12 gap-4">
        <DeckCard title={t("reports.finance")} hint={t("reports.financeHint")} className="col-span-12 xl:col-span-6">
          <FinanceBlock />
        </DeckCard>
        <DeckCard title={t("reports.habits")} hint={t("reports.habitsHint")} className="col-span-12 xl:col-span-6">
          <HabitsBlock range={range} />
        </DeckCard>
        <DeckCard title={t("reports.goals")} hint={t("reports.goalsHint")} className="col-span-12 xl:col-span-6">
          <GoalsBlock range={range} />
        </DeckCard>
        <DeckCard title={t("reports.activity")} hint={t("reports.activityHint")} className="col-span-12 xl:col-span-6">
          <ActivityBlock range={range} />
        </DeckCard>
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
