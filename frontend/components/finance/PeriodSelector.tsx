"use client";

import { deck } from "@/components/ui/deckStyles";
import { t } from "@/lib/i18n";
import { toPeriodRange, type PeriodSel } from "@/lib/finance/finance";

/**
 * Selector de período S6: 5 radio-pills + 2 date inputs solo en custom.
 * Default `{kind:"month"}` lo pone el padre. Valida custom (`from<=to` +
 * formato) vía `toPeriodRange` y muestra error inline ES.
 *
 * T8c coherence pass: los pills y los campos usan el vocabulario compartido
 * del Control Deck (`deck.periodPill`, `deck.fieldInput`), sin cambiar
 * estado, nombres accesibles ni validación.
 */
export default function PeriodSelector({
  value,
  onChange,
  now,
}: {
  value: PeriodSel;
  onChange: (sel: PeriodSel) => void;
  now?: Date;
}) {
  void now;
  const ref = now ?? new Date();
  let customError: string | null = null;
  if (value.kind === "custom") {
    try {
      toPeriodRange(value, ref);
    } catch {
      customError = t("charts.periodInvalidRange");
    }
  }
  const pills: { kind: PeriodSel["kind"]; label: string }[] = [
    { kind: "week", label: t("charts.periodWeek") },
    { kind: "month", label: t("charts.periodMonth") },
    { kind: "quarter", label: t("charts.periodQuarter") },
    { kind: "year", label: t("charts.periodYear") },
    { kind: "custom", label: t("charts.periodCustom") },
  ];
  return (
    <fieldset>
      <legend className={deck.monoMicroLabel}>{t("charts.periodLabel")}</legend>
      <div className="flex flex-wrap gap-2">
        {pills.map((pill) => (
          <label key={pill.kind} className={deck.periodPill}>
            <input
              type="radio"
              name="period"
              value={pill.kind}
              checked={value.kind === pill.kind}
              onChange={() =>
                onChange(
                  pill.kind === "custom"
                    ? { kind: "custom", from: value.from ?? "", to: value.to ?? "" }
                    : { kind: pill.kind },
                )
              }
              className="accent-current"
            />
            {pill.label}
          </label>
        ))}
      </div>
      {value.kind === "custom" ? (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className={deck.fieldLabel}>{t("charts.periodFrom")}</span>
            <input
              aria-label={t("charts.periodFrom")}
              type="date"
              value={value.from ?? ""}
              onChange={(e) => onChange({ kind: "custom", from: e.target.value, to: value.to ?? "" })}
              className={deck.fieldInput}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={deck.fieldLabel}>{t("charts.periodTo")}</span>
            <input
              aria-label={t("charts.periodTo")}
              type="date"
              value={value.to ?? ""}
              onChange={(e) => onChange({ kind: "custom", from: value.from ?? "", to: e.target.value })}
              className={deck.fieldInput}
            />
          </label>
        </div>
      ) : null}
      {customError ? (
        <p role="alert" className="mt-2 text-xs text-alert">
          {customError}
        </p>
      ) : null}
    </fieldset>
  );
}
