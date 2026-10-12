"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import DeckCard, { DeckEmptyState } from "@/components/dashboard/DeckCard";
import { AccountsIcon } from "@/components/dashboard/icons";
import { deck } from "@/components/ui/deckStyles";
import { t } from "@/lib/i18n";
import { useAccounts } from "@/lib/api/dashboard";
import { ApiError } from "@/lib/api/client";
import { createBankAccount, deleteAccount } from "@/lib/api/finance";

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
    <DeckCard title={t("settings.accountsTitle")} hint={t("settings.accountsHint")}>
      <form onSubmit={(e) => void handleCreate(e)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className={deck.fieldLabel}>{t("settings.accountName")}</span>
          <input
            aria-label={t("settings.accountName")}
            className={deck.fieldInput}
            value={name}
            placeholder={t("settings.accountNamePlaceholder")}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button type="submit" disabled={pending} className={deck.signalAction}>
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
          <p role="status" className="text-sm text-faint">
            {t("finance.loadingSections")}
          </p>
        ) : accounts.error && !accounts.data ? (
          <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-4">
            <p className="text-sm text-instrument/70">{t("dashboard.sectionLoadFailed")}</p>
            <button type="button" onClick={() => void revalidate()} className={`mt-3 ${deck.headerAction}`}>
              {t("common.retry")}
            </button>
          </div>
        ) : list.length === 0 ? (
          <DeckEmptyState
            icon={<AccountsIcon className="h-5 w-5" />}
            title={t("settings.noAccounts")}
            hint={t("settings.noAccountsHint")}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((row) => (
              <li
                key={row.id}
                className={deck.listRow}
              >
                <p className="truncate text-sm text-instrument">{row.name}</p>
                <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                  <button
                    type="button"
                    disabled={deletingId === row.id}
                    onClick={() => void handleDelete(row.id, row.name)}
                    aria-label={`${t("settings.delete")}: ${row.name}`}
                    className={deck.dangerAction}
                  >
                    {t("settings.delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DeckCard>
  );
}
