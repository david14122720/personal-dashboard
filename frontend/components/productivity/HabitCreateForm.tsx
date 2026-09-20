"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { t } from "@/lib/i18n";
import { ApiError } from "@/lib/api/client";
import {
  HABITS_TODAY_KEY,
  createHabit,
  type HabitDirection,
  type HabitFrequency,
} from "@/lib/api/productivity";

const inputClass =
  "w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument placeholder:text-instrument/40 focus:border-signal focus:outline-none";

const DOW_SHORT_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

const DIRECTIONS: HabitDirection[] = ["build", "maintain", "reduce", "quit"];
const FREQUENCIES: HabitFrequency[] = ["daily", "weekly", "monthly", "custom"];

function directionLabel(direction: HabitDirection): string {
  if (direction === "build") return t("productivity.tracker.directionBuild");
  if (direction === "maintain") return t("productivity.tracker.directionMaintain");
  if (direction === "reduce") return t("productivity.tracker.directionReduce");
  return t("productivity.tracker.directionQuit");
}

function frequencyLabel(frequency: HabitFrequency): string {
  if (frequency === "daily") return t("productivity.tracker.frequencyDaily");
  if (frequency === "weekly") return t("productivity.tracker.frequencyWeekly");
  if (frequency === "monthly") return t("productivity.tracker.frequencyMonthly");
  return t("productivity.tracker.frequencyCustom");
}

/**
 * Create-only habit form for the standalone `/dashboard/habitos/` page.
 * Mirrors the `ProductivityForms` pattern (Spanish labels, plain inputs,
 * `apiPost` under the hood). No edit/delete/archive flows.
 */
export default function HabitCreateForm({
  onCreated,
  onCancel,
}: {
  onCreated?: () => void;
  onCancel?: () => void;
}) {
  const { mutate } = useSWRConfig();
  const [name, setName] = useState("");
  const [direction, setDirection] = useState<HabitDirection>("build");
  const [frequency, setFrequency] = useState<HabitFrequency>("daily");
  const [days, setDays] = useState<number[]>([]);
  const [target, setTarget] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [color, setColor] = useState("");
  const [icon, setIcon] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  function toggleDay(day: number): void {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)));
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (!name.trim()) {
      setError(t("productivity.requiredError"));
      return;
    }
    if (frequency === "custom" && days.length === 0) {
      setError(t("productivity.requiredError"));
      return;
    }
    if (target.trim()) {
      const value = Number(target.trim());
      if (!Number.isFinite(value) || value <= 0) {
        setError(t("productivity.tracker.createInvalid"));
        return;
      }
    }
    if (start && end && end < start) {
      setError(t("productivity.tracker.createInvalid"));
      return;
    }
    if (name.trim().length > 200 || color.trim().length > 32 || icon.trim().length > 64 || description.trim().length > 2000) {
      setError(t("productivity.tracker.createInvalid"));
      return;
    }
    setPending(true);
    try {
      await createHabit({
        name: name.trim(),
        direction,
        frequency,
        ...(frequency === "custom" ? { days_of_week: [...days].sort((a, b) => a - b) } : {}),
        ...(target.trim() ? { target_per_period: target.trim() } : {}),
        ...(start ? { start_date: start } : {}),
        ...(end ? { end_date: end } : {}),
        ...(color.trim() ? { color: color.trim() } : {}),
        ...(icon.trim() ? { icon: icon.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setSaved(true);
      setName("");
      setDays([]);
      setTarget("");
      setStart("");
      setEnd("");
      setColor("");
      setIcon("");
      setDescription("");
      await mutate(HABITS_TODAY_KEY);
      await mutate("dashboard/habits-today");
      onCreated?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(t("productivity.tracker.createDuplicate"));
      } else if (err instanceof ApiError && err.status === 422) {
        setError(t("productivity.tracker.createInvalid"));
      } else {
        setError(t("productivity.saveFailed"));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      aria-label={t("productivity.tracker.createTitle")}
      className="grid grid-cols-2 gap-3"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <label className="col-span-2 flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.tracker.createName")}
        <input
          aria-label={t("productivity.tracker.createName")}
          placeholder={t("productivity.tracker.createNamePlaceholder")}
          className={inputClass}
          value={name}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.tracker.createDirection")}
        <select
          aria-label={t("productivity.tracker.createDirection")}
          className={inputClass}
          value={direction}
          onChange={(event) => setDirection(event.target.value as HabitDirection)}
        >
          {DIRECTIONS.map((option) => (
            <option key={option} value={option}>
              {directionLabel(option)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.tracker.createFrequency")}
        <select
          aria-label={t("productivity.tracker.createFrequency")}
          className={inputClass}
          value={frequency}
          onChange={(event) => setFrequency(event.target.value as HabitFrequency)}
        >
          {FREQUENCIES.map((option) => (
            <option key={option} value={option}>
              {frequencyLabel(option)}
            </option>
          ))}
        </select>
      </label>
      {frequency === "custom" ? (
        <fieldset className="col-span-2">
          <legend className="text-xs text-instrument/60">{t("productivity.tracker.createDays")}</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {DOW_SHORT_ES.map((label, day) => (
              <label
                key={day}
                className="flex cursor-pointer items-center gap-1.5 rounded-full border border-hull px-3 py-1 text-xs has-checked:border-signal has-checked:text-signal"
              >
                <input
                  type="checkbox"
                  checked={days.includes(day)}
                  onChange={() => toggleDay(day)}
                  aria-label={label}
                  className="accent-signal focus-visible:outline-none"
                />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-instrument/50">{t("productivity.tracker.createDaysHint")}</p>
        </fieldset>
      ) : null}
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.tracker.createTarget")}
        <input
          aria-label={t("productivity.tracker.createTarget")}
          placeholder={t("productivity.tracker.createTargetPlaceholder")}
          className={inputClass}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-instrument/60">
          {t("productivity.tracker.createStart")}
          <input
            aria-label={t("productivity.tracker.createStart")}
            type="date"
            className={inputClass}
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-instrument/60">
          {t("productivity.tracker.createEnd")}
          <input
            aria-label={t("productivity.tracker.createEnd")}
            type="date"
            className={inputClass}
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.tracker.createColor")}
        <input
          aria-label={t("productivity.tracker.createColor")}
          className={inputClass}
          value={color}
          maxLength={32}
          onChange={(event) => setColor(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.tracker.createIcon")}
        <input
          aria-label={t("productivity.tracker.createIcon")}
          className={inputClass}
          value={icon}
          maxLength={64}
          onChange={(event) => setIcon(event.target.value)}
        />
      </label>
      <label className="col-span-2 flex flex-col gap-1 text-xs text-instrument/60">
        {t("productivity.tracker.createDescription")}
        <input
          aria-label={t("productivity.tracker.createDescription")}
          placeholder={t("productivity.tracker.createDescriptionPlaceholder")}
          className={inputClass}
          value={description}
          maxLength={2000}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal disabled:opacity-50"
        >
          {pending ? t("productivity.saving") : t("productivity.create")}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
          >
            {t("productivity.cancel")}
          </button>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-xs text-flow">
            {t("productivity.tracker.createSuccess")}
          </p>
        ) : null}
      </div>
    </form>
  );
}
