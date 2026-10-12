"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import DeckCard, { DeckEmptyState } from "@/components/dashboard/DeckCard";
import { VerifiedIcon } from "@/components/dashboard/icons";
import { deck } from "@/components/ui/deckStyles";
import { t } from "@/lib/i18n";
import { getToken } from "@/lib/api/client";
import {
  listSessions,
  revokeOtherSessions,
  type SessionInfo,
} from "@/lib/api/sessions";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** A5: list the caller's sessions and close every session but this one. */
export default function SessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revokeError, setRevokeError] = useState(false);
  const [revokedOthers, setRevokedOthers] = useState(false);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login/");
    }
  }, [router]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setSessions(await listSessions());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const otherCount = sessions.filter((session) => !session.current).length;

  async function onRevokeOthers() {
    if (!window.confirm(t("settings.sessionsRevokeConfirm"))) return;
    setRevoking(true);
    setRevokeError(false);
    setRevokedOthers(false);
    try {
      await revokeOtherSessions();
      setRevokedOthers(true);
      await refresh();
    } catch {
      setRevokeError(true);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header>
          <h1 className={deck.pageTitle}>
            {t("settings.sessionsTitle")}
          </h1>
          <p className="mt-1 text-sm text-muted">{t("settings.sessionsHint")}</p>
        </header>

        {revokeError ? (
          <p role="alert" className={deck.alertBanner}>
            {t("settings.sessionsRevokeFailed")}
          </p>
        ) : null}

        {revokedOthers ? (
          <p role="status" className={deck.successBanner}>
            {t("settings.sessionsRevokedOthers")}
          </p>
        ) : null}

        <DeckCard
          title={t("settings.sessionsTitle")}
          headerClassName={deck.sectionHeaderWrap}
          action={
            <button
              type="button"
              disabled={revoking || otherCount === 0}
              onClick={() => void onRevokeOthers()}
              className={deck.dangerAction}
            >
              {revoking ? t("settings.sessionsRevoking") : t("settings.sessionsRevokeOthers")}
            </button>
          }
        >
          {loading ? (
            <p role="status" className="text-sm text-faint">
              {t("common.loading")}
            </p>
          ) : loadError ? (
            <div className="flex flex-col gap-3">
              <p role="alert" className="text-sm text-alert">
                {t("settings.sessionsLoadFailed")}
              </p>
              <button
                type="button"
                onClick={() => void refresh()}
                className={`w-fit ${deck.headerAction}`}
              >
                {t("common.retry")}
              </button>
            </div>
          ) : sessions.length === 0 ? (
            <DeckEmptyState
              icon={<VerifiedIcon className="h-5 w-5" />}
              title={t("settings.sessionsEmpty")}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {sessions.map((session) => (
                <li
                  key={session.id}
                  className={deck.cardRow}
                >
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 truncate text-sm font-medium text-instrument">
                      {session.user_agent ?? t("settings.sessionsUnknownAgent")}
                    </p>
                    {session.current ? (
                      <span className={deck.signalPill}>
                        {t("settings.sessionsCurrent")}
                      </span>
                    ) : null}
                  </div>
                  <dl className="grid grid-cols-1 gap-1 text-xs text-muted sm:grid-cols-2">
                    <div className="flex gap-1">
                      <dt className={deck.accountCaption}>{t("settings.sessionsCreated")}:</dt>
                      <dd>{formatDate(session.created_at)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className={deck.accountCaption}>{t("settings.sessionsExpires")}:</dt>
                      <dd>{formatDate(session.expires_at)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className={deck.accountCaption}>{t("settings.sessionsIp")}:</dt>
                      <dd className="font-mono">{session.ip_address ?? "—"}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </DeckCard>
      </div>
    </AppShell>
  );
}
