"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DeckCard, { DeckEmptyState } from "@/components/dashboard/DeckCard";
import { VerifiedIcon } from "@/components/dashboard/icons";
import { deck } from "@/components/ui/deckStyles";
import { t } from "@/lib/i18n";
import { getToken } from "@/lib/api/client";
import { createToken, listTokens, revokeAllTokens, revokeToken, type ApiToken, type CreatedToken } from "@/lib/api/tokens";

// F-13: the backend caps `expires_in_days` at 90, so the picker never offers a
// lifetime the API would reject with 422.
const EXPIRY_OPTIONS = ["30", "90"] as const;

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

export default function ApiTokensPanel() {
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
  const [revokingAll, setRevokingAll] = useState(false);
  const [revokeAllError, setRevokeAllError] = useState(false);
  const [revokedAll, setRevokedAll] = useState<number | null>(null);

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
    setRevokedAll(null);
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
    setRevokedAll(null);
    try {
      await revokeToken(token.id);
      setTokens(await listTokens());
    } catch {
      setActionError(t("tokens.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  // F-13 revoke-all: one confirm, one call, then the list is re-read so the
  // UI shows exactly what the server now holds. The count comes from the
  // response, not from the pre-call list, so it stays truthful when another
  // tab revoked something in between.
  async function onRevokeAll() {
    if (!window.confirm(t("tokens.confirmRevokeAll"))) return;
    setRevokingAll(true);
    setRevokeAllError(false);
    setRevokedAll(null);
    try {
      const { revoked } = await revokeAllTokens();
      setRevokedAll(revoked);
      await refresh();
    } catch {
      setRevokeAllError(true);
    } finally {
      setRevokingAll(false);
    }
  }

  const liveCount = tokens.filter((token) => token.revoked_at === null).length;

  return (
    <section aria-label={t("tokens.title")} className="flex flex-col gap-6">
      <header>
        <h2 className={`flex flex-wrap items-center gap-3 ${deck.pageTitle}`}>
          {t("tokens.title")}
          <span className={deck.signalPill}>
            {t("tokens.activeBadge", { n: tokens.length })}
          </span>
        </h2>
        <p className="mt-1 text-sm text-muted">{t("tokens.subtitle")}</p>
      </header>

        {actionError ? (
          <p role="alert" className={deck.alertBanner}>
            {actionError}
          </p>
        ) : null}

        {revokeAllError ? (
          <p role="alert" className={deck.alertBanner}>
            {t("tokens.revokeAllFailed")}
          </p>
        ) : null}

        {revokedAll !== null ? (
          <p role="status" className={deck.successBanner}>
            {t("tokens.revokeAllDone", { n: revokedAll })}
          </p>
        ) : null}

        {created ? (
          <DeckCard title={t("tokens.createdTitle")}>
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {t("tokens.createdOnce")}
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all rounded-lg border border-hair bg-deck px-3 py-2 text-sm text-signal">
                {created.token}
              </code>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => void onCopy()}
                  className={deck.signalAction}
                >
                  {copied ? t("tokens.copied") : t("tokens.copy")}
                </button>
                <button
                  type="button"
                  onClick={() => setCreated(null)}
                  className={deck.headerAction}
                >
                  {t("tokens.dismiss")}
                </button>
              </div>
            </div>
          </DeckCard>
        ) : null}

        <DeckCard title={t("tokens.createTitle")}>
          <form onSubmit={(e) => void onCreate(e)} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className={deck.fieldLabel}>{t("tokens.name")}</span>
              <input
                type="text"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("tokens.namePlaceholder")}
                className={deck.fieldInput}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={deck.fieldLabel}>{t("tokens.expiry")}</span>
              <select
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className={deck.fieldInput}
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
              className={deck.signalAction}
            >
              {creating ? t("tokens.creating") : t("tokens.create")}
            </button>
          </form>
        </DeckCard>

        <DeckCard
          title={t("tokens.listTitle")}
          headerClassName={deck.sectionHeaderWrap}
          action={
            <button
              type="button"
              disabled={revokingAll || liveCount === 0}
              onClick={() => void onRevokeAll()}
              className={deck.dangerAction}
            >
              {revokingAll ? t("tokens.revokingAll") : t("tokens.revokeAll")}
            </button>
          }
        >
          {loading ? (
            <p role="status" className="text-sm text-faint">
              {t("tokens.loading")}
            </p>
          ) : loadError ? (
            <div className="flex flex-col gap-3">
              <p role="alert" className="text-sm text-alert">
                {t("tokens.loadFailed")}
              </p>
              <button
                type="button"
                onClick={() => void refresh()}
                className={`w-fit ${deck.headerAction}`}
              >
                {t("common.retry")}
              </button>
            </div>
          ) : tokens.length === 0 ? (
            <DeckEmptyState
              icon={<VerifiedIcon className="h-5 w-5" />}
              title={t("tokens.empty")}
              hint={t("tokens.emptyHint")}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {tokens.map((token) => {
                const status = statusOf(token);
                return (
                  <li
                    key={token.id}
                    className={deck.listRow}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-instrument">{token.name}</p>
                      <dl className="mt-1 grid grid-cols-1 gap-1 text-xs text-muted sm:grid-cols-2">
                        <div className="flex gap-1">
                          <dt className={deck.accountCaption}>{t("tokens.prefix")}:</dt>
                          <dd className="font-mono">{token.prefix}</dd>
                        </div>
                        <div className="flex gap-1">
                          <dt className={deck.accountCaption}>{t("tokens.created")}:</dt>
                          <dd>{formatDate(token.created_at)}</dd>
                        </div>
                        <div className="flex gap-1">
                          <dt className={deck.accountCaption}>{t("tokens.expires")}:</dt>
                          <dd>{formatDate(token.expires_at)}</dd>
                        </div>
                        <div className="flex gap-1">
                          <dt className={deck.accountCaption}>{t("tokens.lastUsed")}:</dt>
                          <dd>{formatDate(token.last_used_at)}</dd>
                        </div>
                        <div className="flex gap-1">
                          <dt className={deck.accountCaption}>{t("tokens.status")}:</dt>
                          <dd>{t(`tokens.${status}`)}</dd>
                        </div>
                      </dl>
                    </div>
                    <button
                      type="button"
                      disabled={deletingId === token.id || token.revoked_at !== null}
                      onClick={() => void onDelete(token)}
                      aria-label={`${t("tokens.delete")}: ${token.name}`}
                      className={deck.dangerAction}
                    >
                      {deletingId === token.id ? t("tokens.deleting") : t("tokens.delete")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </DeckCard>
    </section>
  );
}
