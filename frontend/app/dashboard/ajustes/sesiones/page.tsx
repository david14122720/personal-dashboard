"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
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
          <h1 className="font-display text-2xl font-semibold tracking-wide">
            {t("settings.sessionsTitle")}
          </h1>
          <p className="mt-1 text-sm text-instrument/70">{t("settings.sessionsHint")}</p>
        </header>

        {revokeError ? (
          <p role="alert" className="rounded-md border border-alert/50 px-3 py-2 text-sm text-alert">
            {t("settings.sessionsRevokeFailed")}
          </p>
        ) : null}

        {revokedOthers ? (
          <p
            role="status"
            className="rounded-md border border-signal/40 bg-signal/10 px-3 py-2 text-sm text-signal"
          >
            {t("settings.sessionsRevokedOthers")}
          </p>
        ) : null}

        <section
          aria-label={t("settings.sessionsTitle")}
          className="rounded-xl border border-slate-800/80 bg-[#0f131d]/90 p-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-display text-lg font-semibold tracking-wide">
              {t("settings.sessionsTitle")}
            </h2>
            <button
              type="button"
              disabled={revoking || otherCount === 0}
              onClick={() => void onRevokeOthers()}
              className="min-h-[44px] rounded-md border border-hull px-4 font-display text-sm text-instrument/70 transition-colors hover:border-alert hover:text-alert disabled:opacity-40"
            >
              {revoking ? t("settings.sessionsRevoking") : t("settings.sessionsRevokeOthers")}
            </button>
          </div>

          {loading ? (
            <p role="status" className="mt-3 text-sm text-instrument/50">
              {t("common.loading")}
            </p>
          ) : loadError ? (
            <div className="mt-3 flex flex-col gap-3">
              <p role="alert" className="text-sm text-alert">
                {t("settings.sessionsLoadFailed")}
              </p>
              <button
                type="button"
                onClick={() => void refresh()}
                className="min-h-[44px] w-fit rounded-md border border-hull px-4 font-display text-sm transition-colors hover:border-signal hover:text-signal"
              >
                {t("common.retry")}
              </button>
            </div>
          ) : sessions.length === 0 ? (
            <p className="mt-3 text-sm text-instrument/60">{t("settings.sessionsEmpty")}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {sessions.map((session) => (
                <li
                  key={session.id}
                  className="flex flex-col gap-2 rounded-lg border border-hull bg-deck p-4"
                >
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 truncate font-medium">
                      {session.user_agent ?? t("settings.sessionsUnknownAgent")}
                    </p>
                    {session.current ? (
                      <span className="shrink-0 rounded-full border border-signal/20 bg-signal/10 px-2.5 py-0.5 font-mono text-xs font-medium text-signal">
                        {t("settings.sessionsCurrent")}
                      </span>
                    ) : null}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-instrument/60 sm:flex sm:flex-wrap">
                    <div className="flex gap-1">
                      <dt>{t("settings.sessionsCreated")}:</dt>
                      <dd>{formatDate(session.created_at)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>{t("settings.sessionsExpires")}:</dt>
                      <dd>{formatDate(session.expires_at)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>{t("settings.sessionsIp")}:</dt>
                      <dd className="font-mono">{session.ip_address ?? "—"}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
