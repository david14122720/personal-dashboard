/**
 * Pending chat attachments: type rules, previews and the line Hermes reads.
 *
 * Owner spec S3 fixes one allowlist and one ceiling per family; owner spec S4
 * fixes the reference the agent sees once the Rust side stored the file. Both
 * live here so the composer, the upload and the tests cannot drift apart.
 */

export type AttachmentKind = "image" | "video" | "audio" | "document";

export interface PendingAttachment {
  id: string;
  file: File;
  kind: AttachmentKind;
  /** Object URL for local previews; null when the browser cannot create one. */
  previewUrl: string | null;
}

export type AttachmentRejectionCode = "type" | "size" | "count";

/**
 * Per-file upload state the composer draws while a turn is in flight.
 *
 * Owner spec S3 asks for a status bar per card; declared deviation D-B4 rules
 * out a percentage (`fetch` exposes no upload progress), so the four real
 * states are what the chip shows.
 */
export type AttachmentUploadStatus = "queued" | "uploading" | "ready" | "error";

export interface AttachmentRejection {
  code: AttachmentRejectionCode;
  filename: string;
  /** Human hint for the notice: the allowed extensions or the ceiling. */
  detail?: string;
}

export interface AttachmentPlan {
  accepted: PendingAttachment[];
  rejections: AttachmentRejection[];
}

export const MAX_ATTACHMENTS = 20;

const MB = 1024 * 1024;

interface Rule {
  kind: AttachmentKind;
  /** Ceiling in bytes, exactly as S3 states it per family. */
  max: number;
}

/**
 * S3 allowlist. The extension is what decides the family: a `.png` renamed to
 * `.mp4` is caught server-side by the magic-byte check, which is the only place
 * that can honestly claim the real type.
 */
const RULES: Record<string, Rule> = {
  png: { kind: "image", max: 5 * MB },
  jpg: { kind: "image", max: 5 * MB },
  jpeg: { kind: "image", max: 5 * MB },
  webp: { kind: "image", max: 5 * MB },
  gif: { kind: "image", max: 5 * MB },
  mp4: { kind: "video", max: 100 * MB },
  webm: { kind: "video", max: 100 * MB },
  mov: { kind: "video", max: 100 * MB },
  mp3: { kind: "audio", max: 20 * MB },
  wav: { kind: "audio", max: 20 * MB },
  m4a: { kind: "audio", max: 20 * MB },
  ogg: { kind: "audio", max: 20 * MB },
  pdf: { kind: "document", max: 50 * MB },
  docx: { kind: "document", max: 50 * MB },
  xlsx: { kind: "document", max: 50 * MB },
  pptx: { kind: "document", max: 50 * MB },
  txt: { kind: "document", max: 50 * MB },
  md: { kind: "document", max: 50 * MB },
  csv: { kind: "document", max: 50 * MB },
  zip: { kind: "document", max: 50 * MB },
};

/** Extensions grouped for the rejection message, in the order S3 lists them. */
const ALLOWED_LABEL = Object.keys(RULES).join(", ");

export function extensionOf(file: File): string {
  const dot = file.name.lastIndexOf(".");
  if (dot <= 0 || dot === file.name.length - 1) return "";
  return file.name.slice(dot + 1).toLowerCase();
}

/** Audio another family's extension can carry: webm, mp4 and ogg are both. */
const AUDIO_IN_VIDEO_CONTAINER = 20 * MB;

/**
 * `null` when S3 does not allow the extension at all.
 *
 * JD-B-004: `webm` and `mp4` are also audio containers — the microphone records
 * `audio/webm` and `audio/mp4`. The declared MIME decides that ambiguity, so a
 * voice note stays audio (20 MB ceiling, audio bubble) instead of becoming a
 * 100 MB video.
 */
export function ruleFor(file: File): Rule | null {
  const base = RULES[extensionOf(file)] ?? null;
  if (base === null) return null;
  const declared = (file.type || "").toLowerCase();
  if (base.kind === "video" && declared.startsWith("audio/")) {
    return { kind: "audio", max: AUDIO_IN_VIDEO_CONTAINER };
  }
  if (base.kind === "audio" && declared.startsWith("video/")) {
    return { kind: "video", max: 100 * MB };
  }
  return base;
}

/**
 * The family the composer draws, or `null` for a file S3 rejects.
 *
 * The declared MIME is only a hint: a `.md` sent as `text/markdown` and a `.md`
 * sent as `application/octet-stream` are the same document, and the server
 * still sniffs the bytes.
 */
export function classifyFile(file: File): AttachmentKind | null {
  return ruleFor(file)?.kind ?? null;
}

/** S3's ceiling for this file, or `null` when the type is not allowed. */
export function maxBytesFor(file: File): number | null {
  return ruleFor(file)?.max ?? null;
}

export function previewUrlFor(file: File, kind: AttachmentKind): string | null {
  if (kind !== "image" && kind !== "video" && kind !== "audio") return null;
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  try {
    return URL.createObjectURL(file);
  } catch {
    // Some test environments expose a shim that only accepts host Blobs; a
    // missing preview must never block attaching the file itself.
    return null;
  }
}

let nextId = 1;

export function makeAttachment(file: File, kind: AttachmentKind): PendingAttachment {
  const id = `att-${nextId}`;
  nextId += 1;
  return { id, file, kind, previewUrl: previewUrlFor(file, kind) };
}

export function releaseAttachment(attachment: PendingAttachment): void {
  if (attachment.previewUrl && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

/**
 * Decide which incoming files fit, one verdict per file.
 *
 * A valid file is never dropped because a sibling was rejected, and the count
 * cap names the file that crossed it, so the notice can be specific instead of
 * a generic "some files failed".
 */
export function planAttachments(
  existing: readonly PendingAttachment[],
  incoming: readonly File[],
): AttachmentPlan {
  const accepted: PendingAttachment[] = [];
  const rejections: AttachmentRejection[] = [];
  let count = existing.length;

  for (const file of incoming) {
    const rule = ruleFor(file);
    if (rule === null) {
      rejections.push({ code: "type", filename: file.name, detail: ALLOWED_LABEL });
      continue;
    }
    if (file.size > rule.max) {
      rejections.push({
        code: "size",
        filename: file.name,
        detail: formatBytes(rule.max),
      });
      continue;
    }
    if (count >= MAX_ATTACHMENTS) {
      rejections.push({
        code: "count",
        filename: file.name,
        detail: String(MAX_ATTACHMENTS),
      });
      continue;
    }
    accepted.push(makeAttachment(file, rule.kind));
    count += 1;
  }

  return { accepted, rejections };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/** `nota-de-voz-<stamp>.webm` — stable, human-readable, never a path. */
export function voiceFileName(mime: string, stamp = Date.now()): string {
  const extension = mime.includes("mp4")
    ? "mp4"
    : mime.includes("ogg")
      ? "ogg"
      : mime.includes("wav")
        ? "wav"
        : "webm";
  return `nota-de-voz-${new Date(stamp).toISOString().replace(/[:.]/g, "-")}.${extension}`;
}

/** What the Rust side stored: exactly the JSON keys of spec S4. */
export interface StoredUpload {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  url: string;
  local_path: string;
}

/**
 * The line Hermes reads for a file it must open with its own tools (S4).
 *
 * The path is the one the Rust side chose inside the shared volume, so the
 * agent never has to guess where the browser put the bytes.
 */
export function attachmentReference(upload: StoredUpload): string {
  return `[archivo adjunto: ${upload.name} (${upload.mime_type}, ${formatBytes(upload.size)}), ruta: ${upload.local_path}]`;
}

/** Append the stored-file references to the user's text, in upload order. */
export function composeTurnText(content: string, uploads: readonly StoredUpload[]): string {
  const refs = uploads.map((upload) => attachmentReference(upload));
  if (refs.length === 0) return content;
  return [content.trim(), ...refs].filter((part) => part.length > 0).join("\n\n");
}

/**
 * Which attachments still travel inline to the model.
 *
 * Owner spec S4: an image ≤ 5 MB becomes an `image_url` part, so its bytes go
 * to the runs proxy. Everything else — documents, audio, video, archives — is
 * uploaded once and referenced by path, which is what lets Hermes open a 100 MB
 * video without the Runs API ever seeing it.
 */
export function travelsInline(kind: AttachmentKind): boolean {
  return kind === "image";
}
