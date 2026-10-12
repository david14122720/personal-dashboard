"use client";

import type { ReactNode } from "react";
import { useSWRConfig } from "swr";
import AppShell from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import DeckCard, { DeckEmptyState } from "@/components/dashboard/DeckCard";
import { BalanceIcon } from "@/components/dashboard/icons";
import KpiTile from "@/components/ui/KpiTile";
import { deck } from "@/components/ui/deckStyles";
import {
  eventsKey, tasksKey, useEvents as useDashboardEvents, useGoals as useDashboardGoals,
  useNetWorth, useTasks as useDashboardTasks,
} from "@/lib/api/dashboard";
import { HABITS_TODAY_KEY, habitsHistoryKey, useHabitsHistory, useHabitsToday } from "@/lib/api/productivity";
import { toEventRange, todayInBogota } from "@/lib/finance/finance";
import { aggregateEvolution, habitStats } from "@/lib/productivity/habitStats";
import { scoreByArea, type AreaKey } from "@/lib/productivity/scoreByArea";
import { formatMoney, toNumber } from "@/lib/api/money";
import { toFinanceScore, toUpcomingEvents } from "@/lib/dashboard/transforms";
import { todayYmdLocal } from "@/lib/productivity/productivity";

/**
 * S4 progreso: combinado FE-only, ventana fija 30 días. Patrimonio = número de
 * solo lectura (valuaciones INSERT-only, sin escritura). Finanzas = patrimonio
 * neto actual con score vía `toFinanceScore` (100/0/null, solo visual).
 * Score solo visual + disclaimer fijo siempre visible.
 *
 * T8c coherence pass (no design source for this route): ported to the Control
 * Deck language of `dashboard-desktop.html` — `DeckCard` panels with the
 * hairlined section header, `KpiTile` figures, mono micro-labels, deck rows,
 * the prototype empty state and the shared progress track. It is NOT a
 * chrome-only pass: the same pass also derives the pending habits from the real
 * logs of the Bogotá business day (`habitStatusOnBogotaDay`, because the
 * endpoint's `today_status` is UTC-anchored) and renders the new
 * `progress.pendingNone` line (“Ninguno pendiente hoy”) when that list is
 * empty. Hooks and the rest of the copy are unchanged; the pending list's
 * numbers are not.
 */

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
  if (loading) return <p role="status" aria-label={t("progress.loadingBlock")} className="py-6 text-center text-sm text-faint">{t("common.loading")}</p>;
  if (error) {
    return (
      <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-4 sm:p-5">
        <h3 className="font-display text-sm font-semibold text-alert-soft">{t("progress.loadFailed")}</h3>
        <p className="mt-1 text-sm text-instrument/70">{t("progress.loadFailedHint")}</p>
        <button type="button" onClick={onRetry} className={`mt-3 ${deck.cardAction}`}>{t("common.retry")}</button>
      </div>
    );
  }
  if (empty) return <>{emptyNode}</>;
  return <>{children}</>;
}

/** Decorative area glyph of a score tile (D3: inline SVG, never an icon font). */
function AreaGlyph({ area }: { area: AreaKey }) {
  if (area === "finance") return <BalanceIcon className="h-3.5 w-3.5" />;
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      {area === "habits" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 12.4l2.4 2.4 4.6-5.4" />
        </>
      ) : area === "goals" ? (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="12" cy="12" r="1" fill="currentColor" />
        </>
      ) : (
        <path d="M13 10V3L4 14h7v7l9-11h-7z" />
      )}
    </svg>
  );
}

/** Decorative glyph of the shared empty state (D3: inline SVG). */
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

const AREA_LABEL: Record<AreaKey, string> = {
  finance: t("progress.score.finance"), habits: t("progress.score.habits"),
  goals: t("progress.score.goals"), productivity: t("progress.score.productivity"),
};

const inRange = (day: string | null | undefined, from: string, to: string): boolean => {
  if (!day) return false;
  const date = day.slice(0, 10);
  return date >= from && date <= to;
};

/** Weekday of a `YYYY-MM-DD` calendar day (0 = Sunday, the Postgres
 * `EXTRACT(DOW)` convention the real `days_of_week` masks use). */
function dowOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/**
 * Real state of a `GET /habits/today` row on the Bogotá business day.
 *
 * `today_status` is anchored to the database's UTC `CURRENT_DATE`; between
 * 19:00 and midnight Bogotá that is already the next day, so every habit reads
 * `pending` on a day whose real log says `done`. The day's own log is the
 * authority and only a missing log falls back to the schedule (`pending` when
 * the Bogotá day expects the habit, `skipped` when it does not), never a fake
 * `done`. Mirrors `statusOnBogotaDay` in the «Hoy» widget.
 */
export function habitStatusOnBogotaDay(
  row: { habit_id: string; days_of_week?: number[] | null },
  day: string,
  logs: Array<{ habit_id: string; log_date: string; status: string }>,
): string {
  const log = logs.find((entry) => entry.habit_id === row.habit_id && entry.log_date === day);
  if (log) return log.status;
  const mask = row.days_of_week ?? [];
  return mask.length === 0 || mask.includes(dowOf(day)) ? "pending" : "skipped";
}

export default function ProgressScreens({ now }: { now?: Date }) {
  const ref = now ?? new Date();
  const { from, to } = range30(ref);
  const { mutate } = useSWRConfig();
  const worth = useNetWorth();
  const today = useHabitsToday();
  const history = useHabitsHistory(from, to);
  const goals = useDashboardGoals();
  const tasks = useDashboardTasks("done");
  // `GET /events` exige RFC 3339 (una fecha desnuda es 422): el período alimenta el
  // score y la ventana propia de próximos 14 días alimenta la agenda.
  const periodEvents = toEventRange({ from, to });
  const nextEvents = toEventRange(upcomingWindow(ref));
  const events = useDashboardEvents(periodEvents.from, periodEvents.to);
  const upcoming = useDashboardEvents(nextEvents.from, nextEvents.to);

  const habits = today.data ?? [];
  const logs = history.data ?? [];
  const goalItems = goals.data ?? [];
  const doneTasks = (tasks.data ?? []).filter((task) => inRange((task as { completed_at?: string | null }).completed_at, from, to));
  const upcomingEvents = toUpcomingEvents(upcoming.data ?? [], ref, 14);

  const cop = (worth.data?.per_currency ?? []).find((e) => e.currency === "COP") ?? worth.data?.per_currency[0];
  const netWorthValue = cop ? toNumber(cop.net_worth) : null;

  // Finance score from the only surviving input (net worth): null when no data.
  const financeScoreRaw = toFinanceScore({ netWorth: netWorthValue });
  const financeScore = financeScoreRaw === null ? null : Math.round(financeScoreRaw * 10) / 10;
  const compliances = habits.map((h) => habitStats(logs.filter((l) => l.habit_id === h.habit_id), from, to, h.days_of_week).complianceRate);
  const habitsScore = habits.length === 0 || logs.length === 0 ? null
    : Math.round((compliances.reduce((a, b) => a + b, 0) / compliances.length) * 10) / 10;
  const goalPcts = goalItems.map((g) => g.progress ?? 0);
  const goalsScore = goalPcts.length === 0 ? null : Math.round((goalPcts.reduce((a, b) => a + b, 0) / goalPcts.length) * 10) / 10;
  // Escala visual documentada: 5+ completadas ≈ 100; sin tareas ni eventos → sin datos.
  const noProdData = !tasks.data || !events.data || (doneTasks.length === 0 && upcomingEvents.length === 0 && tasks.data.length === 0 && (events.data ?? []).length === 0);
  const productivityScore = noProdData ? null : Math.min(100, doneTasks.length * 20);
  const scores = scoreByArea({ finance: financeScore, habits: habitsScore, goals: goalsScore, productivity: productivityScore });

  const statsOf = (id: string, days?: number[]) => habitStats(logs.filter((l) => l.habit_id === id), from, to, days);
  // The real logs of the Bogotá business day decide the pending list, never
  // the endpoint's UTC-anchored `today_status`. While that read is unanswered
  // `Block` renders its loading state instead of the list, so the page cannot
  // claim a habit is pending before the day's logs answer.
  const day = todayInBogota();
  const pending =
    history.data === undefined
      ? []
      : habits.filter((h) => habitStatusOnBogotaDay(h, day, logs) === "pending");
  const evolution = aggregateEvolution(logs, habits.map((h) => ({ id: h.habit_id, name: h.name })), "week");
  const advanced = goalItems.filter((g) => (g.progress ?? 0) > 0);

  return (
    <div>
      <h1 className={deck.pageTitle}>{t("progress.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("progress.subtitle")}</p>
      <DeckCard title={t("progress.score.title")} hint={t("progress.score.hint")} className="mt-6">
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {scores.map((s) => (
            <li key={s.area}>
              <KpiTile
                label={AREA_LABEL[s.area]}
                icon={<AreaGlyph area={s.area} />}
                signal={s.hasData}
                value={s.hasData ? `${s.value} %` : t("progress.score.noData")}
                valueClass={deck.kpiValue}
              >
                <div
                  role="progressbar"
                  aria-label={AREA_LABEL[s.area]}
                  aria-valuenow={s.value ?? 0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className={deck.kpiProgressTrack}
                >
                  <div className={deck.kpiProgressFillSignal} style={{ width: `${s.value ?? 0}%` }} />
                </div>
              </KpiTile>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-instrument/60">{t("progress.score.disclaimer")}</p>
      </DeckCard>
      <div className="mt-4 grid grid-cols-12 gap-4">
        <DeckCard title={t("progress.finance")} hint={t("progress.financeHint")} className="col-span-12 xl:col-span-6">
          <Block loading={!worth.data && !worth.error} error={Boolean(worth.error)} empty={Boolean(worth.data && !cop)}
            emptyNode={<DeckEmptyState icon={<EmptyGlyph />} title={t("progress.emptyFinance")} hint={t("progress.emptyFinanceHint")} />}
            onRetry={() => void mutate("dashboard/net-worth")}>
            {cop ? (
              <KpiTile
                label={t("dashboard.netWorth")}
                icon={<BalanceIcon className="h-3.5 w-3.5" />}
                signal
                glow="hairline"
                value={formatMoney(netWorthValue as number)}
                valueClass={deck.kpiValue}
              />
            ) : null}
          </Block>
        </DeckCard>
        <DeckCard title={t("progress.netWorth")} hint={t("progress.netWorthHint")} className="col-span-12 xl:col-span-6">
          <Block loading={!worth.data && !worth.error} error={!!worth.error} empty={!!worth.data && !cop}
            emptyNode={<DeckEmptyState icon={<EmptyGlyph />} title={t("progress.emptyWorth")} hint={t("progress.emptyWorthHint")} />}
            onRetry={() => void mutate("dashboard/net-worth")}>
            {cop ? <p className={deck.kpiValue}>{formatMoney(toNumber(cop.net_worth))}</p> : null}
          </Block>
        </DeckCard>
        <DeckCard title={t("progress.goals")} hint={t("progress.goalsHint")} className="col-span-12 xl:col-span-6">
          <Block loading={!goals.data && !goals.error} error={!!goals.error}
            empty={!!goals.data && goalItems.length === 0}
            emptyNode={<DeckEmptyState icon={<EmptyGlyph />} title={t("progress.emptyGoals")} hint={t("progress.emptyGoalsHint")} />}
            onRetry={() => void mutate("dashboard/goals")}>
            <ul className="space-y-2">
              {goalItems.map((g) => (
                <li key={g.id} className={deck.listRow}>
                  <span className="min-w-0 truncate text-sm font-semibold text-instrument">{g.name}</span>
                  <span className={deck.cardMetric}>{`${g.progress ?? 0} %`}</span>
                </li>
              ))}
            </ul>
          </Block>
        </DeckCard>
        <DeckCard title={t("progress.habits")} hint={t("progress.habitsHint")} className="col-span-12 xl:col-span-6">
          <Block loading={(!today.data && !today.error) || (!history.data && !history.error)} error={!!today.error || !!history.error}
            empty={!!today.data && !!history.data && habits.length === 0}
            emptyNode={<DeckEmptyState icon={<EmptyGlyph />} title={t("progress.emptyHabits")} hint={t("progress.emptyHabitsHint")} />}
            onRetry={() => {
              void mutate(HABITS_TODAY_KEY);
              void mutate(habitsHistoryKey(from, to));
            }}>
            <h3 className={deck.monoMicroLabel}>{t("progress.pendingHabits")}</h3>
            {pending.length === 0 ? (
              <p className="text-sm text-faint">{t("progress.pendingNone")}</p>
            ) : (
              <ul className="space-y-2">{pending.map((h) => (<li key={h.habit_id} className={deck.statTile}><span className="text-sm text-instrument">{h.name}</span></li>))}</ul>
            )}
            <h3 className={`mt-4 ${deck.monoMicroLabel}`}>{t("progress.bestStreaks")}</h3>
            <ul className="space-y-2">{habits.map((h) => (<li key={h.habit_id} className={deck.statTile}><span className="text-sm text-instrument">{h.name} · {statsOf(h.habit_id, h.days_of_week).bestStreak}</span></li>))}</ul>
            <h3 className={`mt-4 ${deck.monoMicroLabel}`}>{t("progress.weeklyEvolution")}</h3>
            <ul className="space-y-2">{evolution.map((s) => (<li key={s.name} className={deck.statTile}><span className="text-sm text-instrument">{s.name} · {s.points.slice(-4).map((p) => `${p.bucket}:${p.done}`).join(" ")}</span></li>))}</ul>
          </Block>
        </DeckCard>
        <DeckCard title={t("progress.productivity")} hint={t("progress.productivityHint")} className="col-span-12">
          <Block loading={(!tasks.data && !tasks.error) || (!upcoming.data && !upcoming.error)} error={!!tasks.error || !!upcoming.error}
            empty={!!tasks.data && !!upcoming.data && doneTasks.length === 0 && upcomingEvents.length === 0 && advanced.length === 0}
            emptyNode={<DeckEmptyState icon={<EmptyGlyph />} title={t("progress.emptyActivity")} hint={t("progress.emptyActivityHint")} />}
            onRetry={() => void mutate((k) => typeof k === "string" && (k === tasksKey("done", true) || k === eventsKey(periodEvents.from, periodEvents.to, true) || k === eventsKey(nextEvents.from, nextEvents.to, true)))}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <h3 className={deck.monoMicroLabel}>{t("progress.completedTasks")} ({doneTasks.length})</h3>
                <ul className="space-y-2">{doneTasks.map((task) => (<li key={task.id} className={deck.statTile}><span className="text-sm text-instrument">{task.title}</span></li>))}</ul>
              </div>
              <div>
                <h3 className={deck.monoMicroLabel}>{t("progress.advancedGoals")} ({advanced.length})</h3>
                <ul className="space-y-2">{advanced.map((g) => (<li key={g.id} className={deck.statTile}><span className="text-sm text-instrument">{g.name}</span></li>))}</ul>
              </div>
              <div>
                <h3 className={deck.monoMicroLabel}>{t("progress.upcomingEvents")} ({upcomingEvents.length})</h3>
                <ul className="space-y-2">{upcomingEvents.map((e) => (<li key={e.id} className={deck.statTile}><span className="text-sm text-instrument">{e.title}</span></li>))}</ul>
              </div>
            </div>
          </Block>
        </DeckCard>
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
