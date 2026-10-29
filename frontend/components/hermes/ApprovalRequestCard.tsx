"use client";

import { t } from "@/lib/i18n";

export type ApprovalDecision = "idle" | "pending" | "approved" | "denied" | "expired";

/**
 * Security gate: Hermes wants to run a command on its server and waits for
 * the user. Presentational only — the parent owns the POST and the decision
 * state. Buttons are real `<button>`s and the command block is plain text, so
 * keyboard users never get trapped.
 */
export default function ApprovalRequestCard({
  tool,
  command,
  description,
  decision,
  error,
  onApprove,
  onDeny,
}: {
  tool: string;
  command: string;
  description?: string | null;
  decision: ApprovalDecision;
  error?: string | null;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const settled = decision === "approved" || decision === "denied" || decision === "expired";
  const busy = decision === "pending";

  return (
    <div
      role="alert"
      data-testid="hermes-approval"
      className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3"
    >
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="mt-0.5 text-amber-300">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
            <path
              d="M10 2l6 2.5v4.4c0 3.9-2.6 6.2-6 7.6-3.4-1.4-6-3.7-6-7.6V4.5L10 2z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path
              d="M7.5 9.5V8a2.5 2.5 0 015 0v1.5M7 9.5h6v5H7v-5z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-amber-100">{t("hermes.approvalTitle")}</p>
          <p className="mt-0.5 font-mono text-[11px] text-amber-200/90">{tool}</p>
        </div>
      </div>

      <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-deck/70 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-100">
        {command}
      </pre>

      {description ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-amber-200/80">{description}</p>
      ) : null}
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{t("hermes.approvalHint")}</p>

      {decision === "approved" ? (
        <p data-testid="hermes-approval-resolved" className="mt-2 text-xs font-semibold text-emerald-300">
          ✓ {t("hermes.approved")}
        </p>
      ) : decision === "denied" ? (
        <p data-testid="hermes-approval-resolved" className="mt-2 text-xs font-semibold text-rose-300">
          ✕ {t("hermes.denied")}
        </p>
      ) : decision === "expired" ? (
        <p data-testid="hermes-approval-resolved" className="mt-2 text-xs font-semibold text-muted">
          {t("hermes.approvalExpired")}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="rounded-lg bg-emerald-500/90 px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t("hermes.approveSending") : t("hermes.approve")}
          </button>
          <button
            type="button"
            onClick={onDeny}
            disabled={busy}
            className="rounded-lg border border-rose-400/50 px-3 py-1.5 text-xs font-semibold text-rose-200 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t("hermes.approveSending") : t("hermes.deny")}
          </button>
        </div>
      )}

      {error && !settled ? (
        <p role="note" className="mt-2 text-[11px] leading-relaxed text-rose-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
