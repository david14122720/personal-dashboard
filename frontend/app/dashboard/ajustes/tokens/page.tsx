"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import { getToken } from "@/lib/api/client";
import { createToken, listTokens, revokeToken, type ApiToken, type CreatedToken } from "@/lib/api/tokens";

const EXPIRY_OPTIONS = ["30", "90", "365"] as const;

function formatDate(value: string | null): string {
  if (!value) return t("tokens.never");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(date);
}

function statusOf(token: ApiToken): "revoked" | "expired" | "active" {
  if (token.revoked_at) return "revoked";
  if (token.expires_at && new Date(token.expires_at).getTime() < Date.now()) return "expired";
  return "active";
}

export default function TokensPage() {
  const router = useRouter();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<string>("never");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login/");
    }
  }, [router]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setTokens(await listTokens());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 80) {
      setActionError(t("tokens.nameRequired"));
      return;
    }
    setCreating(true);
    setActionError(null);
    setCopied(false);
    try {
      const result = await createToken(
        trimmed,
        expiry === "never" ? undefined : Number(expiry),
      );
      setCreated(result);
      setName("");
      setExpiry("never");
      setTokens(await listTokens());
    } catch {
      setActionError(t("tokens.createFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function onCopy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch {
      // Clipboard unavailable (permissions): the raw stays visible for manual copy.
    }
  }

  async function onDelete(token: ApiToken) {
    if (!window.confirm(t("tokens.confirmDelete", { name: token.name }))) return;
    setDeletingId(token.id);
    setActionError(null);
    try {
      await revokeToken(token.id);
      setTokens(await listTokens());
    } catch {
      setActionError(t("tokens.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header>
          <h1 className="font-display text-2xl font-semibold tracking-wide">{t("tokens.title")}</h1>
          <p className="mt-1 text-sm text-instrument/70">{t("tokens.subtitle")}</p>
        </header>

        {actionError ? (
          <p role="alert" className="rounded-md border border-alert/50 px-3 py-2 text-sm text-alert">
            {actionError}
          </p>
        ) : null}

        {created ? (
          <section
            aria-label={t("tokens.createdTitle")}
            className="rounded-xl border border-signal/60 bg-hull/40 p-5"
          >
            <h2 className="font-display text-lg font-semibold tracking-wide">{t("tokens.createdTitle")}</h2>
            <p className="mt-1 text-sm text-instrument/70">{t("tokens.createdOnce")}</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all rounded-md border border-hull bg-deck px-3 py-2 text-sm text-signal">
                {created.token}
              </code>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => void onCopy()}
                  className="rounded-md bg-signal px-3 py-2 font-display text-sm font-semibold tracking-wide text-deck transition-opacity disabled:opacity-60"
                >
                  {copied ? t("tokens.copied") : t("tokens.copy")}
                </button>
                <button
                  type="button"
                  onClick={() => setCreated(null)}
                  className="rounded-md border border-hull px-3 py-2 font-display text-sm text-instrument/70 transition-colors hover:border-signal hover:text-signal"
                >
                  {t("tokens.dismiss")}
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <section
          aria-label={t("tokens.createTitle")}
          className="rounded-xl border border-hull bg-hull/40 p-5"
        >
          <h2 className="font-display text-lg font-semibold tracking-wide">{t("tokens.createTitle")}</h2>
          <form onSubmit={(e) => void onCreate(e)} className="mt-4 flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              {t("tokens.name")}
              <input
                type="text"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("tokens.namePlaceholder")}
                className="rounded-md border border-hull bg-deck px-3 py-2 text-instrument placeholder:text-instrument/40"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("tokens.expiry")}
              <select
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className="rounded-md border border-hull bg-deck px-3 py-2 text-instrument"
              >
                <option value="never">{t("tokens.expiryNever")}</option>
                {EXPIRY_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {t("tokens.expiryDays", { n: days })}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={creating}
              className="rounded-md bg-signal px-3 py-2 font-display text-sm font-semibold tracking-wide text-deck transition-opacity disabled:opacity-60"
            >
              {creating ? t("tokens.creating") : t("tokens.create")}
            </button>
          </form>
        </section>

        <section
          aria-label={t("tokens.listTitle")}
          className="rounded-xl border border-hull bg-hull/40 p-5"
        >
          <h2 className="font-display text-lg font-semibold tracking-wide">{t("tokens.listTitle")}</h2>
          {loading ? (
            <p role="status" className="mt-3 text-sm text-instrument/50">
              {t("tokens.loading")}
            </p>
          ) : loadError ? (
            <div className="mt-3 flex flex-col gap-3">
              <p role="alert" className="text-sm text-alert">
                {t("tokens.loadFailed")}
              </p>
              <button
                type="button"
                onClick={() => void refresh()}
                className="w-fit rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal"
              >
                {t("common.retry")}
              </button>
            </div>
          ) : tokens.length === 0 ? (
            <div className="mt-3">
              <p className="text-sm font-medium">{t("tokens.empty")}</p>
              <p className="mt-1 text-sm text-instrument/60">{t("tokens.emptyHint")}</p>
            </div>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {tokens.map((token) => {
                const status = statusOf(token);
                return (
                  <li
                    key={token.id}
                    className="flex flex-col gap-2 rounded-lg border border-hull bg-deck p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{token.name}</p>
                      <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-instrument/60 sm:flex sm:flex-wrap">
                        <div className="flex gap-1">
                          <dt>{t("tokens.prefix")}:</dt>
                          <dd className="font-mono">{token.prefix}</dd>
                        </div>
                        <div className="flex gap-1">
                          <dt>{t("tokens.created")}:</dt>
                          <dd>{formatDate(token.created_at)}</dd>
                        </div>
                        <div className="flex gap-1">
                          <dt>{t("tokens.expires")}:</dt>
                          <dd>{formatDate(token.expires_at)}</dd>
                        </div>
                        <div className="flex gap-1">
                          <dt>{t("tokens.lastUsed")}:</dt>
                          <dd>{formatDate(token.last_used_at)}</dd>
                        </div>
                        <div className="flex gap-1">
                          <dt>{t("tokens.status")}:</dt>
                          <dd>{t(`tokens.${status}`)}</dd>
                        </div>
                      </dl>
                    </div>
                    <button
                      type="button"
                      disabled={deletingId === token.id || token.revoked_at !== null}
                      onClick={() => void onDelete(token)}
                      aria-label={`${t("tokens.delete")}: ${token.name}`}
                      className="shrink-0 rounded-md border border-hull px-3 py-2 font-display text-sm text-instrument/70 transition-colors hover:border-alert hover:text-alert disabled:opacity-40"
                    >
                      {deletingId === token.id ? t("tokens.deleting") : t("tokens.delete")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
