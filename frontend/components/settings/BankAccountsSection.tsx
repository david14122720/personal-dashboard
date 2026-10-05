"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import EmptyState from "@/components/ui/EmptyState";
import { t } from "@/lib/i18n";
import { useAccounts } from "@/lib/api/dashboard";
import { ApiError } from "@/lib/api/client";
import { createBankAccount, deleteAccount } from "@/lib/api/finance";

const inputClass =
  "min-h-11 w-full rounded-md border border-hull bg-deck px-3 text-sm text-instrument transition-colors placeholder:text-slate-500 focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/30";
const primaryBtnClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-signal px-4 font-display text-sm font-semibold text-deck transition-colors hover:bg-signal-soft disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtnClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-hull px-3 font-display text-sm text-instrument-dim transition-colors hover:border-signal hover:text-signal disabled:cursor-not-allowed disabled:opacity-50";
const dangerBtnClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-hull px-3 font-display text-sm text-instrument-dim transition-colors hover:border-alert hover:text-alert disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Accounts manager (Configuración → P5). Creates accounts by name/alias and
 * deletes them; the Finanzas `Cuentas` section reads the same backend list,
 * so new accounts show up there automatically. W1: accounts carry no type, so
 * every non-archived account is listed (the endpoint filters archived rows)
 * and creation posts the name only.
 */
export default function BankAccountsSection() {
  const { mutate } = useSWRConfig();
  const accounts = useAccounts();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const list = accounts.data ?? [];

  async function revalidate(): Promise<void> {
    setError(null);
    await mutate((key) => typeof key === "string" && key.startsWith("dashboard/"));
    await mutate((key) => typeof key === "string" && key.startsWith("finance/"));
  }

  async function handleCreate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t("finance.requiredFieldError"));
      return;
    }
    setPending(true);
    try {
      await createBankAccount(name.trim());
      setName("");
      await revalidate();
    } catch {
      setError(t("finance.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(id: string, accountName: string): Promise<void> {
    if (!window.confirm(t("settings.confirmDeleteAccount", { name: accountName }))) return;
    setDeletingId(id);
    setError(null);
    try {
      await deleteAccount(id);
      await revalidate();
    } catch (err) {
      // 409: the account owns movements and stays listed with its balance.
      setError(err instanceof ApiError && err.status === 409
        ? t("finance.accountDeleteBlocked")
        : t("finance.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section
      aria-label={t("settings.accountsTitle")}
      className="rounded-xl border border-hull bg-panel/90 p-4 sm:p-5"
    >
      <h2 className="font-display text-base font-medium tracking-wide">{t("settings.accountsTitle")}</h2>
      <p className="mt-1 text-xs text-slate-400">{t("settings.accountsHint")}</p>
      <form onSubmit={(e) => void handleCreate(e)} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-xs text-instrument/60">
          {t("settings.accountName")}
          <input
            aria-label={t("settings.accountName")}
            className={inputClass}
            value={name}
            placeholder={t("settings.accountNamePlaceholder")}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button type="submit" disabled={pending} className={primaryBtnClass}>
          {pending ? t("finance.saving") : t("settings.createAccount")}
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-alert">
          {error}
        </p>
      ) : null}
      <div className="mt-4">
        {accounts.isLoading ? (
          <p role="status" className="text-sm text-instrument/50">
            {t("finance.loadingSections")}
          </p>
        ) : accounts.error && !accounts.data ? (
          <div role="alert" className="rounded-lg border border-alert/50 bg-alert/10 p-4">
            <p className="text-sm text-instrument/70">{t("dashboard.sectionLoadFailed")}</p>
            <button type="button" onClick={() => void revalidate()} className={`mt-3 ${ghostBtnClass}`}>
              {t("common.retry")}
            </button>
          </div>
        ) : list.length === 0 ? (
          <EmptyState title={t("settings.noAccounts")} hint={t("settings.noAccountsHint")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-3 rounded-lg border border-hull px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="truncate text-sm">{row.name}</p>
                <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                  <button
                    type="button"
                    disabled={deletingId === row.id}
                    onClick={() => void handleDelete(row.id, row.name)}
                    aria-label={`${t("settings.delete")}: ${row.name}`}
                    className={dangerBtnClass}
                  >
                    {t("settings.delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
