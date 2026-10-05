"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { t } from "@/lib/i18n";
import { apiDelete } from "@/lib/api/client";
import { createValuation, patchAsset } from "@/lib/api/finance";
import { normalizeManualAmount, type NamedOption } from "@/lib/finance/finance";

// Canonical field/primary/ghost strings from the UI-polish contract
// (`design.md`, "Canonical visual contract"): one role, one look.
const inputClass =
  "min-h-11 w-full rounded-md border border-hull bg-deck px-3 text-sm text-instrument transition-colors placeholder:text-slate-500 focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/30";
const btnClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-signal px-4 font-display text-sm font-semibold text-deck transition-colors hover:bg-signal-soft disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtnClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-hull px-3 font-display text-sm text-instrument-dim transition-colors hover:border-signal hover:text-signal";

const ASSET_CATEGORIES = ["cash", "account", "investment", "equipment", "vehicle", "property", "other"];

export interface AssetEditInitial {
  name?: string | null;
  category?: string | null;
  account_id?: string | null;
  acquired_on?: string | null;
  notes?: string | null;
}

/** Editar metadatos (allowlist real); archivar con confirmación vía DELETE existente. */
export function AssetEditForm({
  assetId, accounts, initial, onDone,
}: { assetId: string; accounts: NamedOption[]; initial?: AssetEditInitial | null; onDone: () => void }) {
  const { mutate } = useSWRConfig();
  // JD-ASSET: precarga opcional con la categoría almacenada (AssetWire ya la trae).
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "other");
  const [accountId, setAccountId] = useState(initial?.account_id ?? "");
  const [acquiredOn, setAcquiredOn] = useState(initial?.acquired_on ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function revalidate(): Promise<void> {
    await mutate("finance/assets");
    await mutate("dashboard/net-worth");
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!name.trim()) { setError(t("finance.requiredFieldError")); return; }
    setPending(true);
    try {
      await patchAsset(assetId, { name: name.trim(), category, ...(accountId ? { account_id: accountId } : {}), ...(acquiredOn ? { acquired_on: acquiredOn } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) });
      await revalidate();
      onDone();
    } catch {
      setError(t("finance.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  async function archive(): Promise<void> {
    if (!window.confirm(t("finance.confirmArchiveAsset"))) return;
    setPending(true);
    try {
      await apiDelete(`/assets/${assetId}`);
      await revalidate();
      onDone();
    } catch {
      setError(t("finance.deleteFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label={t("finance.assets")} className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => void handleSubmit(e)}>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.goalName")}
        <input aria-label={t("finance.goalName")} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.category")}
        <select aria-label={t("finance.category")} className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
          {ASSET_CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.account")}
        <select aria-label={t("finance.account")} className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">{t("finance.selectAccount")}</option>
          {accounts.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.dateLabel")}
        <input aria-label={t("finance.dateLabel")} type="date" className={inputClass} value={acquiredOn} onChange={(e) => setAcquiredOn(e.target.value)} />
      </label>
      <label className="sm:col-span-2 flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.description")}
        <input aria-label={t("finance.description")} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={btnClass}>{pending ? t("finance.saving") : t("productivity.save")}</button>
        <button type="button" disabled={pending} onClick={() => void archive()} className={ghostBtnClass}>{t("productivity.delete")}</button>
        {error ? (<p role="alert" className="text-xs text-alert">{error}</p>) : null}
      </div>
    </form>
  );
}

/** Valuar vía POST existente; valida recorded_on posterior a la última conocida. */
export function AssetValuationForm({
  assetId, lastRecordedOn, onDone,
}: { assetId: string; lastRecordedOn?: string | null; onDone: () => void }) {
  const { mutate } = useSWRConfig();
  const [value, setValue] = useState("");
  const [recordedOn, setRecordedOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const wire = normalizeManualAmount(value);
    if (!wire || !recordedOn) { setError(!wire ? t("finance.amountPositiveError") : t("finance.requiredFieldError")); return; }
    if (lastRecordedOn && recordedOn <= lastRecordedOn) { setError(t("finance.valuationDateError")); return; }
    setPending(true);
    try {
      await createValuation(assetId, { value: wire, recorded_on: recordedOn });
      await mutate("finance/assets");
      await mutate("dashboard/net-worth");
      onDone();
    } catch {
      setError(t("finance.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label={t("finance.assets")} className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => void handleSubmit(e)}>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.assetValue")}
        <input aria-label={t("finance.assetValue")} inputMode="decimal" className={inputClass} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.dateLabel")}
        <input aria-label={t("finance.dateLabel")} type="date" className={inputClass} value={recordedOn} onChange={(e) => setRecordedOn(e.target.value)} />
      </label>
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={btnClass}>{pending ? t("finance.saving") : t("finance.valuate")}</button>
        {error ? (<p role="alert" className="text-xs text-alert">{error}</p>) : null}
      </div>
    </form>
  );
}
