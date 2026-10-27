/**
 * Pending chat attachments: classification, guardrails and preview URLs.
 *
 * The limits mirror the Rust proxy (`MAX_ATTACHMENTS`, `MAX_FILE_BYTES`,
 * `MAX_TOTAL_ATTACHMENT_BYTES`). They bound memory, not file types: images,
 * documents, audio and archives all travel the same path.
 */

export type AttachmentKind = "image" | "audio" | "text" | "other";

export interface PendingAttachment {
  id: string;
  file: File;
  kind: AttachmentKind;
  /** Object URL for local previews; null when the browser cannot create one. */
  previewUrl: string | null;
}

export type AttachmentRejection =
  | "too_many"
  | "file_too_large"
  | "total_too_large";

export interface AttachmentPlan {
  accepted: PendingAttachment[];
  rejection: { code: AttachmentRejection; filename?: string } | null;
}

export const MAX_ATTACHMENTS = 20;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

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
 * the first file that breaks a limit is reported so the UI can name it.
 */
export function planAttachments(
  existing: readonly PendingAttachment[],
  incoming: readonly File[],
): AttachmentPlan {
  const accepted: PendingAttachment[] = [];
  let count = existing.length;
  let total = existing.reduce((sum, item) => sum + item.file.size, 0);

  for (const file of incoming) {
    if (count >= MAX_ATTACHMENTS) {
      return { accepted, rejection: { code: "too_many", filename: file.name } };
    }
    if (file.size > MAX_FILE_BYTES) {
      return { accepted, rejection: { code: "file_too_large", filename: file.name } };
    }
    if (total + file.size > MAX_TOTAL_BYTES) {
      return { accepted, rejection: { code: "total_too_large", filename: file.name } };
    }
    accepted.push(makeAttachment(file));
    count += 1;
    total += file.size;
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
