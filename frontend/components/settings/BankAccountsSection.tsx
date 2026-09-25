"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { t } from "@/lib/i18n";
import { useAccounts } from "@/lib/api/dashboard";
import { ApiError } from "@/lib/api/client";
import { createBankAccount, deleteAccount } from "@/lib/api/finance";

const inputClass =
  "w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument placeholder:text-instrument/40 focus:border-signal focus:outline-none";
const btnClass =
  "rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal disabled:opacity-50";

/**
 * Bank accounts manager (Configuración → P5). Creates `bank` accounts by
 * name/alias and deletes them; the Finanzas `Cuentas` section reads the same
 * backend list, so new accounts show up there automatically.
 */
export default function BankAccountsSection() {
  const { mutate } = useSWRConfig();
  const accounts = useAccounts();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const banks = (accounts.data ?? []).filter((row) => row.type === "bank");

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
      className="rounded-xl border border-slate-800/80 bg-[#0f131d]/90 p-5"
    >
      <h2 className="font-display text-lg font-semibold tracking-wide">{t("settings.accountsTitle")}</h2>
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
        <button type="submit" disabled={pending} className={btnClass}>
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
            <button type="button" onClick={() => void revalidate()} className={`mt-3 ${btnClass}`}>
              {t("common.retry")}
            </button>
          </div>
        ) : banks.length === 0 ? (
          <div>
            <p className="text-sm font-medium">{t("settings.noAccounts")}</p>
            <p className="mt-1 text-sm text-instrument/60">{t("settings.noAccountsHint")}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {banks.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-hull px-3 py-2"
              >
                <p className="truncate text-sm">{row.name}</p>
                <button
                  type="button"
                  disabled={deletingId === row.id}
                  onClick={() => void handleDelete(row.id, row.name)}
                  aria-label={`${t("settings.delete")}: ${row.name}`}
                  className={btnClass}
                >
                  {t("settings.delete")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
