/**
 * Pending chat attachments: classification and preview URLs.
 *
 * The runs proxy has no byte ceiling (owner spec S2): it counts and discards
 * non-image bytes chunk by chunk and streams back whatever Hermes delivers.
 * Only the attachment *count* stays bounded, because each chip is a separate
 * multipart part. Binary files that go through `POST /api/hermes/upload` are
 * bounded separately by that route's 25 MB per-file budget (see
 * `MAX_UPLOAD_DOCUMENT_BYTES`).
 */

export type AttachmentKind = "image" | "audio" | "text" | "other";

export interface PendingAttachment {
  id: string;
  file: File;
  kind: AttachmentKind;
  /** Object URL for local previews; null when the browser cannot create one. */
  previewUrl: string | null;
}

export type AttachmentRejection = "too_many";

export interface AttachmentPlan {
  accepted: PendingAttachment[];
  rejection: { code: AttachmentRejection; filename?: string } | null;
}

export const MAX_ATTACHMENTS = 20;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "csv", "tsv", "xml", "yaml", "yml", "log",
  "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "java", "kt", "rb",
  "php", "sh", "bash", "toml", "ini", "cfg", "conf", "sql", "html", "htm",
  "css", "scss", "svelte", "vue", "patch", "diff", "env",
]);

const TEXT_MIME = new Set([
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/javascript",
  "application/typescript",
]);

let nextId = 1;

export function classifyFile(file: File): AttachmentKind {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("text/")) return "text";
  if (TEXT_MIME.has(mime)) return "text";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(extension) ? "text" : "other";
}

export function previewUrlFor(file: File, kind: AttachmentKind): string | null {
  if (kind !== "image" && kind !== "audio") return null;
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  try {
    return URL.createObjectURL(file);
  } catch {
    // Some test environments expose a shim that only accepts host Blobs; a
    // missing thumbnail must never block attaching the file itself.
    return null;
  }
}

export function makeAttachment(file: File): PendingAttachment {
  const kind = classifyFile(file);
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
 * Decide which incoming files fit. It never silently truncates a valid batch:
 * the first file that breaks the count is reported so the UI can name it.
 */
export function planAttachments(
  existing: readonly PendingAttachment[],
  incoming: readonly File[],
): AttachmentPlan {
  const accepted: PendingAttachment[] = [];
  let count = existing.length;

  for (const file of incoming) {
    if (count >= MAX_ATTACHMENTS) {
      return { accepted, rejection: { code: "too_many", filename: file.name } };
    }
    accepted.push(makeAttachment(file));
    count += 1;
  }

  return { accepted, rejection: null };
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

/**
 * The line the agent reads when a document was stored server-side (spec S8).
 * It names the exact URL so Hermes can fetch it with its own tools instead of
 * guessing a path inside its container.
 */
export function attachmentReference(url: string): string {
  return `[archivo adjunto: ${url}]`;
}

/** Append the stored-file references to the user's text, in upload order. */
export function composeTurnText(content: string, urls: readonly string[]): string {
  const refs = urls.map((url) => attachmentReference(url));
  if (refs.length === 0) return content;
  return [content.trim(), ...refs].filter((part) => part.length > 0).join("\n\n");
}

/**
 * Which attachment kinds travel to `/api/hermes/upload`.
 *
 * Only non-text binaries do. The runs proxy still inlines text-like files into
 * the prompt (`backend/src/routes/hermes.rs`, 16 000-byte truncation), so
 * `.md/.txt/.csv/.json` reach the agent without a URL fetch; uploading them
 * would make a large CSV that used to arrive truncated fail hard with 413 and
 * would turn every readable document into a dependency on the agent's fetch
 * tools. Images keep the inline data-URL path and audio keeps its degraded
 * note.
 */
export function isUploadedDocument(kind: AttachmentKind): boolean {
  return kind === "other";
}
