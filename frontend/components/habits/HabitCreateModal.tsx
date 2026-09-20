"use client";

import { useEffect, useRef, useState } from "react";
import { t, type EsKey } from "@/lib/i18n";
import { ApiError } from "@/lib/api/client";
import { createHabit, type HabitDirection, type HabitFrequency } from "@/lib/api/productivity";
import { todayYmdLocal } from "@/lib/productivity/productivity";
import { HABIT_ICON_NAMES, HabitIcon, type HabitIconName } from "./HabitGrid";

const inputClass =
  "w-full rounded-lg border border-hull bg-deck px-3 py-2 text-sm text-instrument placeholder:text-instrument/40 focus:border-signal focus:outline-none";

const CATEGORY_OPTIONS: Array<{ value: string; labelKey: EsKey }> = [
  { value: "Salud & Físico", labelKey: "habitsDashboard.filterHealth" },
  { value: "Productividad", labelKey: "habitsDashboard.filterProductivity" },
  { value: "Mentalidad", labelKey: "habitsDashboard.filterMind" },
];

/** Mon-first weekdays with the backend `EXTRACT(DOW)` numbering (0 = Sunday). */
const WEEKDAYS: Array<{ value: number; labelKey: EsKey }> = [
  { value: 1, labelKey: "habitsDashboard.weekdayMon" },
  { value: 2, labelKey: "habitsDashboard.weekdayTue" },
  { value: 3, labelKey: "habitsDashboard.weekdayWed" },
  { value: 4, labelKey: "habitsDashboard.weekdayThu" },
  { value: 5, labelKey: "habitsDashboard.weekdayFri" },
  { value: 6, labelKey: "habitsDashboard.weekdaySat" },
  { value: 0, labelKey: "habitsDashboard.weekdaySun" },
];

const COLORS: Array<{ value: string; labelKey: EsKey }> = [
  { value: "#38BDF8", labelKey: "habitsDashboard.colorCyan" },
  { value: "#4F7CFF", labelKey: "habitsDashboard.colorBlue" },
  { value: "#A78BFA", labelKey: "habitsDashboard.colorViolet" },
  { value: "#22C55E", labelKey: "habitsDashboard.colorGreen" },
  { value: "#F59E0B", labelKey: "habitsDashboard.colorAmber" },
  { value: "#F43F5E", labelKey: "habitsDashboard.colorRose" },
  { value: "#2DD4BF", labelKey: "habitsDashboard.colorTeal" },
  { value: "#94A3B8", labelKey: "habitsDashboard.colorSlate" },
];

const ICON_LABELS: Record<HabitIconName, EsKey> = {
  run: "habitsDashboard.iconRun",
  water: "habitsDashboard.iconWater",
  book: "habitsDashboard.iconBook",
  dumbbell: "habitsDashboard.iconDumbbell",
  brain: "habitsDashboard.iconBrain",
  moon: "habitsDashboard.iconMoon",
  sun: "habitsDashboard.iconSun",
  meditation: "habitsDashboard.iconMeditation",
  apple: "habitsDashboard.iconApple",
  pill: "habitsDashboard.iconPill",
  code: "habitsDashboard.iconCode",
  pen: "habitsDashboard.iconPen",
  music: "habitsDashboard.iconMusic",
  leaf: "habitsDashboard.iconLeaf",
  flame: "habitsDashboard.iconFlame",
  target: "habitsDashboard.iconTarget",
};

export interface HabitCreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void | Promise<void>;
}

/**
 * Centered create-habit modal (`Nuevo hábito`): backdrop + Esc + outside
 * click + Cancelar close, initial focus on the name field and Tab cycling
 * inside the panel. Posts through `createHabit` and hands control back to
 * the dashboard, which revalidates list + history so the row appears without
 * a reload.
 */
export default function HabitCreateModal({ open, onClose, onCreated }: HabitCreateModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState("");
  const [direction, setDirection] = useState<HabitDirection>("build");
  const [frequency, setFrequency] = useState<HabitFrequency>("daily");
  const [days, setDays] = useState<number[]>([]);
  const [target, setTarget] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [category, setCategory] = useState("");
  const [shortLabel, setShortLabel] = useState("");
  const [color, setColor] = useState<string>(COLORS[0].value);
  const [icon, setIcon] = useState<HabitIconName | "">("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Fresh form each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setName("");
    setDirection("build");
    setFrequency("daily");
    setDays([]);
    setTarget("");
    setStart("");
    setEnd("");
    setCategory("");
    setShortLabel("");
    setColor(COLORS[0].value);
    setIcon("");
    setDescription("");
    setNameError(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = (): HTMLElement[] =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    nameRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Pull focus back into the panel if it escapes while the modal is open.
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (event: FocusEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (event.target instanceof Node && panel.contains(event.target)) return;
      nameRef.current?.focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open]);

  if (!open) return null;

  function toggleDay(day: number): void {
    setDays((prev) => (prev.includes(day) ? prev.filter((value) => value !== day) : [...prev, day].sort((a, b) => a - b)));
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setNameError(t("habitsDashboard.createNameRequired"));
      nameRef.current?.focus();
      return;
    }
    setNameError(null);
    if (frequency === "custom" && days.length === 0) {
      setError(t("habitsDashboard.createDaysHint"));
      return;
    }
    if (start && end && end < start) {
      setError(t("habitsDashboard.createInvalid"));
      return;
    }
    setPending(true);
    try {
      await createHabit({
        name: name.trim(),
        direction,
        frequency,
        ...(frequency === "custom" ? { days_of_week: days } : {}),
        ...(target.trim() ? { target_per_period: target.trim() } : {}),
        ...(start ? { start_date: start } : { start_date: todayYmdLocal() }),
        ...(end ? { end_date: end } : {}),
        ...(category.trim() ? { category: category.trim() } : {}),
        ...(shortLabel.trim() ? { short_label: shortLabel.trim() } : {}),
        ...(color ? { color } : {}),
        ...(icon ? { icon } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      await onCreated?.();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(t("habitsDashboard.createDuplicate"));
      } else if (err instanceof ApiError && err.status === 422) {
        setError(t("habitsDashboard.createInvalid"));
      } else {
        setError(t("habitsDashboard.createFailed"));
      }
    } finally {
      setPending(false);
    }
  }

  const sectionLabel = "font-display text-[11px] uppercase tracking-widest text-instrument/50";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="habit-create-title"
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/5 bg-gradient-to-b from-hull/40 to-deck/60 p-[22px] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="habit-create-title" className="font-deck-display text-xl font-bold text-instrument">
            {t("habitsDashboard.createTitle")}
          </h2>
          <button
            type="button"
            aria-label={t("habitsDashboard.reportClose")}
            onClick={onClose}
            className="rounded-md p-1 text-instrument/60 transition-colors hover:text-signal"
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(event) => void handleSubmit(event)}>
          <label className="flex flex-col gap-1 text-xs text-instrument/60 sm:col-span-2">
            {t("habitsDashboard.createName")}
            <input
              ref={nameRef}
              className={inputClass}
              value={name}
              maxLength={200}
              placeholder={t("habitsDashboard.createNamePlaceholder")}
              onChange={(event) => setName(event.target.value)}
            />
            {nameError ? (
              <span role="alert" className="text-[11px] text-alert">
                {nameError}
              </span>
            ) : null}
          </label>

          <div className="flex flex-col gap-1">
            <span className={sectionLabel}>{t("habitsDashboard.createDirection")}</span>
            <div role="group" aria-label={t("habitsDashboard.createDirection")} className="flex gap-2">
              <button
                type="button"
                aria-pressed={direction === "build"}
                onClick={() => setDirection("build")}
                className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                  direction === "build" ? "bg-signal text-deck" : "border border-hull text-instrument/60 hover:text-signal"
                }`}
              >
                {t("habitsDashboard.directionBuild")}
              </button>
              <button
                type="button"
                aria-pressed={direction === "quit"}
                onClick={() => setDirection("quit")}
                className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                  direction === "quit" ? "bg-signal text-deck" : "border border-hull text-instrument/60 hover:text-signal"
                }`}
              >
                {t("habitsDashboard.directionAvoid")}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className={sectionLabel}>{t("habitsDashboard.createFrequency")}</span>
            <div role="group" aria-label={t("habitsDashboard.createFrequency")} className="flex flex-wrap gap-2">
              {(
                [
                  ["daily", "habitsDashboard.frequencyDaily"],
                  ["weekly", "habitsDashboard.frequencyWeekly"],
                  ["monthly", "habitsDashboard.frequencyMonthly"],
                  ["custom", "habitsDashboard.frequencyCustom"],
                ] as Array<[HabitFrequency, EsKey]>
              ).map(([value, labelKey]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={frequency === value}
                  onClick={() => setFrequency(value)}
                  className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                    frequency === value ? "bg-signal text-deck" : "border border-hull text-instrument/60 hover:text-signal"
                  }`}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>

          {frequency === "custom" ? (
            <fieldset className="sm:col-span-2">
              <legend className={sectionLabel}>{t("habitsDashboard.createDays")}</legend>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {WEEKDAYS.map(({ value, labelKey }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={days.includes(value)}
                    onClick={() => toggleDay(value)}
                    className={`rounded-full px-3 py-1 text-xs transition-colors ${
                      days.includes(value) ? "bg-signal text-deck" : "border border-hull text-instrument/60 hover:text-signal"
                    }`}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          <label className="flex flex-col gap-1 text-xs text-instrument/60">
            {t("habitsDashboard.createTarget")}
            <input
              className={inputClass}
              value={target}
              placeholder={t("habitsDashboard.createTargetPlaceholder")}
              onChange={(event) => setTarget(event.target.value)}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-instrument/60">
              {t("habitsDashboard.createStart")}
              <input
                type="date"
                className={inputClass}
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-instrument/60">
              {t("habitsDashboard.createEnd")}
              <input type="date" className={inputClass} value={end} onChange={(event) => setEnd(event.target.value)} />
            </label>
          </div>

          <div className="flex flex-col gap-1 sm:col-span-2">
            <span className={sectionLabel}>{t("habitsDashboard.createCategory")}</span>
            <div className="flex flex-wrap items-center gap-2">
              {CATEGORY_OPTIONS.map(({ value, labelKey }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={category === value}
                  onClick={() => setCategory((prev) => (prev === value ? "" : value))}
                  className={`rounded-full px-3 py-1 text-xs transition-colors ${
                    category === value ? "bg-signal text-deck" : "border border-hull text-instrument/60 hover:text-signal"
                  }`}
                >
                  {t(labelKey)}
                </button>
              ))}
              <input
                className={`${inputClass} max-w-52`}
                value={category}
                maxLength={64}
                aria-label={t("habitsDashboard.createCategory")}
                placeholder={t("habitsDashboard.createCategoryPlaceholder")}
                onChange={(event) => setCategory(event.target.value)}
              />
            </div>
          </div>

          <label className="flex flex-col gap-1 text-xs text-instrument/60">
            {t("habitsDashboard.createShortLabel")}
            <input
              className={inputClass}
              value={shortLabel}
              maxLength={32}
              placeholder={t("habitsDashboard.createShortLabelPlaceholder")}
              onChange={(event) => setShortLabel(event.target.value)}
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className={sectionLabel}>{t("habitsDashboard.createColor")}</span>
            <div role="group" aria-label={t("habitsDashboard.createColor")} className="flex flex-wrap gap-2">
              {COLORS.map(({ value, labelKey }) => (
                <button
                  key={value}
                  type="button"
                  aria-label={t(labelKey)}
                  aria-pressed={color === value}
                  onClick={() => setColor((prev) => (prev === value ? "" : value))}
                  className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                    color === value ? "border-instrument" : "border-transparent"
                  }`}
                  style={{ backgroundColor: value }}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1 sm:col-span-2">
            <span className={sectionLabel}>{t("habitsDashboard.createIcon")}</span>
            <div role="group" aria-label={t("habitsDashboard.createIcon")} className="grid grid-cols-8 gap-2">
              {HABIT_ICON_NAMES.map((iconName) => (
                <button
                  key={iconName}
                  type="button"
                  aria-label={t(ICON_LABELS[iconName])}
                  aria-pressed={icon === iconName}
                  onClick={() => setIcon((prev) => (prev === iconName ? "" : iconName))}
                  className={`flex h-10 items-center justify-center rounded-lg transition-colors ${
                    icon === iconName
                      ? "bg-signal/20 text-signal ring-1 ring-signal"
                      : "bg-hull/40 text-instrument/60 hover:text-signal"
                  }`}
                >
                  <HabitIcon name={iconName} className="h-5 w-5" />
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1 text-xs text-instrument/60 sm:col-span-2">
            {t("habitsDashboard.createDescription")}
            <textarea
              className={inputClass}
              rows={2}
              value={description}
              maxLength={2000}
              placeholder={t("habitsDashboard.createDescriptionPlaceholder")}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>

          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-xl bg-signal px-5 py-2 font-display text-sm font-semibold text-deck transition-colors hover:bg-signal/90 disabled:opacity-50"
            >
              {t("habitsDashboard.createSubmit")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-hull px-5 py-2 font-display text-sm text-instrument transition-colors hover:border-signal hover:text-signal"
            >
              {t("habitsDashboard.cancel")}
            </button>
            {error ? (
              <p role="alert" className="text-xs text-alert">
                {error}
              </p>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
