"use client";

import { formatBytes } from "@/lib/hermes/attachments";
import { isEmbeddedUrl, type Artifact } from "@/lib/hermes/artifacts";
import { t } from "@/lib/i18n";

function KindGlyph({ kind }: { kind: Artifact["kind"] }) {
  const shared = "h-4 w-4 text-sky-300";
  if (kind === "image") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={shared}>
        <rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="7.5" cy="8.5" r="1.3" fill="currentColor" />
        <path d="M4.5 14l4-4 3 3 2-2 2.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "audio" || kind === "video") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={shared}>
        <rect x="3" y="4.5" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8.5 8l4 2-4 2V8z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "code") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={shared}>
        <path d="M7 6l-3.5 4L7 14M13 6l3.5 4L13 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={shared}>
      <path d="M6 3.5h5l4 4v9H6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M11 3.5v4h4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * One file delivered by Hermes. Images preview inline (with `no-referrer`, so
 * an artifact cannot carry the dashboard URL to the file host); everything
 * else shows a labelled card. Audio/video get native controls. Every card has
 * an explicit download link.
 */
export default function ArtifactCard({ artifact }: { artifact: Artifact }) {
  // A model-authored URL must never load on render: only embedded payloads
  // preview. Everything else stays one explicit click away.
  const preview = isEmbeddedUrl(artifact.url);
  const meta = [artifact.mime, artifact.size ? formatBytes(artifact.size) : null]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  return (
    <figure
      data-testid="hermes-artifact"
      className="overflow-hidden rounded-lg border border-hair bg-deck/60"
    >
      {preview && artifact.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artifact.url}
          alt={artifact.name}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="block max-h-56 w-auto max-w-full bg-black/20 object-contain"
        />
      ) : null}
      {artifact.kind === "audio" ? (
        <audio controls preload="none" src={artifact.url} className="w-full px-2 pt-2">
          <track kind="captions" />
        </audio>
      ) : null}
      {artifact.kind === "video" ? (
        <video controls preload="none" src={artifact.url} className="block max-h-56 w-auto max-w-full bg-black/20">
          <track kind="captions" />
        </video>
      ) : null}

      <figcaption className="flex items-center gap-3 px-3 py-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-sky-500/10">
          <KindGlyph kind={artifact.kind} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-instrument" title={artifact.name}>
            {artifact.name}
          </span>
          <span className="block truncate text-[10px] text-muted">
            {meta || t("hermes.artifactLabel")}
          </span>
        </span>
        <a
          href={artifact.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-1 rounded-md border border-hair px-2 py-1.5 text-[11px] font-semibold text-slate-200 transition-colors hover:border-sky-500/40 hover:text-sky-300"
        >
          {t("hermes.open")}
        </a>
        <a
          href={artifact.url}
          download={artifact.name}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("hermes.downloadNamed", { name: artifact.name })}
          title={t("hermes.downloadNamed", { name: artifact.name })}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1.5 text-[11px] font-semibold text-sky-300 transition-colors hover:bg-sky-500/20 sm:px-2.5"
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
            <path d="M10 3.5v8M6.5 8.5L10 12l3.5-3.5M4.5 15.5h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="sr-only sm:not-sr-only">{t("hermes.download")}</span>
        </a>
      </figcaption>
    </figure>
  );
}
