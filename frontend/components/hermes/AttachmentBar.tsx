"use client";

import {
  formatBytes,
  type AttachmentKind,
  type AttachmentUploadStatus,
  type PendingAttachment,
} from "@/lib/hermes/attachments";
import { t } from "@/lib/i18n";

/**
 * Family icon shared by the composer chips and the user bubbles.
 *
 * `kind` is the S3 family, never a MIME guess: the extension decided it when
 * the file was attached.
 */
export function KindIcon({
  kind,
  className,
}: {
  kind: AttachmentKind;
  className?: string;
}) {
  const base = className ?? "h-4 w-4 text-sky-300";
  if (kind === "image") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={base}>
        <rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="7.5" cy="8.5" r="1.3" fill="currentColor" />
        <path d="M4.5 14l4-4 3 3 2-2 2.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "audio") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={base}>
        <path d="M4 8v4M7 6v8M10 4.5v11M13 7v6M16 9v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "video") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={base}>
        <rect x="2.5" y="5" width="11" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M13.5 9l4-2.2v6.4L13.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={base}>
      <path d="M6 3.5h5l4 4v9H6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M11 3.5v4h4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The four real upload states (S3 + declared deviation D-B4: no percentage,
 * because `fetch` exposes no upload progress and XHR would duplicate the HTTP
 * client). `lib/i18n/es.ts` is outside this task's edit surface, so the copy
 * lives here until a translation pass moves it into the catalog.
 */
const UPLOAD_STATUS_LABEL: Record<AttachmentUploadStatus, string> = {
  queued: "en cola",
  uploading: "subiendo",
  ready: "listo",
  error: "error",
};

const UPLOAD_STATUS_BAR: Record<AttachmentUploadStatus, string> = {
  queued: "bg-sky-500/30",
  uploading: "animate-pulse bg-sky-400",
  ready: "bg-emerald-400",
  error: "bg-rose-500",
};

function UploadStatus({
  name,
  status,
}: {
  name: string;
  status: AttachmentUploadStatus;
}) {
  const label = UPLOAD_STATUS_LABEL[status];
  return (
    <span
      data-testid="attachment-status"
      data-status={status}
      className="mt-1 flex items-center gap-1.5"
    >
      {/* D-B4: a thin state bar, not a fake transfer percentage. */}
      <span
        role="progressbar"
        aria-label={name}
        aria-valuetext={label}
        className="block h-0.5 w-16 overflow-hidden rounded-full bg-hair"
      >
        <span
          className={`block h-full rounded-full ${UPLOAD_STATUS_BAR[status]}`}
          style={{ width: "100%" }}
        />
      </span>
      <span aria-hidden="true" className="text-[10px] text-muted">
        {label}
      </span>
    </span>
  );
}

/**
 * Chips for the turn's pending attachments, with per-file removal and the
 * upload state of a turn already sent. It only renders local previews (object
 * URLs); nothing leaves the browser until send.
 */
export default function AttachmentBar({
  items,
  onRemove,
  disabled = false,
  statusOf,
}: {
  items: readonly PendingAttachment[];
  onRemove: (id: string) => void;
  disabled?: boolean;
  statusOf?: (id: string) => AttachmentUploadStatus | undefined;
}) {
  if (items.length === 0) return null;
  return (
    <ul aria-label={t("hermes.attachmentsLabel")} className="mb-2 flex flex-wrap gap-2">
      {items.map((item) => {
        const status = statusOf?.(item.id);
        return (
          <li
            key={item.id}
            data-testid="attachment-chip"
            className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-hair bg-deck/70 py-1.5 pl-2 pr-1"
          >
            {item.previewUrl && item.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.previewUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-sky-500/10">
                <KindIcon kind={item.kind} />
              </span>
            )}
            <span className="min-w-0">
              <span className="block max-w-[9rem] truncate text-xs font-medium text-instrument" title={item.file.name}>
                {item.file.name}
              </span>
              <span className="block text-[10px] text-muted">{formatBytes(item.file.size)}</span>
              {status ? <UploadStatus name={item.file.name} status={status} /> : null}
            </span>
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              disabled={disabled}
              aria-label={t("hermes.removeAttachment", { name: item.file.name })}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hair hover:text-instrument disabled:opacity-40"
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
