/**
 * Files Hermes delivers inside a reply.
 *
 * Two sources, one shape: an explicit `artifacts` array from the proxy (when
 * the agent reports them) and links the agent wrote in Markdown. Remote files
 * are never auto-loaded: only embedded `data:` payloads preview inline, so a
 * model-authored URL cannot beacon on render.
 */

export type ArtifactKind = "image" | "audio" | "video" | "code" | "document" | "file";

export interface Artifact {
  id: string;
  name: string;
  url: string;
  mime?: string;
  size?: number;
  kind: ArtifactKind;
}

const EXTENSION_KIND: Record<string, ArtifactKind> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  svg: "image", avif: "image", bmp: "image", ico: "image",
  mp3: "audio", wav: "audio", ogg: "audio", oga: "audio", m4a: "audio",
  flac: "audio", aac: "audio", opus: "audio",
  mp4: "video", webm: "video", mov: "video", mkv: "video",
  rs: "code", ts: "code", tsx: "code", js: "code", jsx: "code", py: "code",
  go: "code", java: "code", kt: "code", rb: "code", php: "code", sh: "code",
  json: "code", yml: "code", yaml: "code", toml: "code", sql: "code",
  css: "code", html: "code", md: "code", txt: "code", csv: "code", log: "code",
  pdf: "document", doc: "document", docx: "document", xls: "document",
  xlsx: "document", ppt: "document", pptx: "document", odt: "document",
  zip: "document", tar: "document", gz: "document", rar: "document",
  "7z": "document",
};

const SAFE_SCHEMES = [
  "http://",
  "https://",
  "data:image/",
  "data:audio/",
  "data:video/",
  "data:application/pdf",
  "data:text/plain",
  "data:text/csv",
  "data:text/markdown",
];
/** Embedded payloads are safe to render: no network request leaves the page. */
export function isEmbeddedUrl(url: string): boolean {
  return url.startsWith("data:");
}

export function isSafeArtifactUrl(url: string): boolean {
  const trimmed = url.trim();
  return SAFE_SCHEMES.some((prefix) => trimmed.startsWith(prefix));
}

function pathOf(url: string): string {
  if (url.startsWith("data:")) return "";
  const withoutQuery = url.split(/[?#]/, 1)[0];
  try {
    return new URL(withoutQuery, "https://placeholder.invalid").pathname;
  } catch {
    return withoutQuery;
  }
}

export function extensionOf(url: string): string {
  const path = pathOf(url);
  const tail = path.split("/").pop() ?? "";
  const dot = tail.lastIndexOf(".");
  return dot === -1 ? "" : tail.slice(dot + 1).toLowerCase();
}

export function fileNameOf(url: string, fallback = "archivo"): string {
  if (url.startsWith("data:")) return fallback;
  const tail = pathOf(url).split("/").pop() ?? "";
  if (!tail) return fallback;
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}

export function artifactKind(mime: string | undefined, url: string): ArtifactKind {
  const normalized = (mime ?? "").toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("audio/")) return "audio";
  if (normalized.startsWith("video/")) return "video";
  if (normalized === "application/pdf") return "document";
  if (normalized.startsWith("text/")) return "code";
  if (normalized) return "document";
  return EXTENSION_KIND[extensionOf(url)] ?? "file";
}

/** Only links that look like a delivered file become artifact cards. */
export function isFileUrl(url: string): boolean {
  if (url.startsWith("data:")) return isSafeArtifactUrl(url);
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  return extensionOf(url) in EXTENSION_KIND;
}

function pushArtifact(target: Artifact[], seen: Set<string>, artifact: Artifact) {
  if (!isSafeArtifactUrl(artifact.url) || seen.has(artifact.url)) return;
  seen.add(artifact.url);
  target.push(artifact);
}

function fromPayload(
  items: readonly { name?: string; url?: string; mime?: string; size?: number }[],
  target: Artifact[],
  seen: Set<string>,
) {
  for (const item of items) {
    if (!item?.url) continue;
    const url = item.url;
    pushArtifact(target, seen, {
      id: url,
      name: item.name?.trim() || fileNameOf(url),
      url,
      mime: item.mime,
      size: item.size,
      kind: artifactKind(item.mime, url),
    });
  }
}

function fromMarkdown(reply: string, target: Artifact[], seen: Set<string>) {
  const links = /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of reply.matchAll(links)) {
    const [, label, url] = match;
    if (!isFileUrl(url)) continue;
    pushArtifact(target, seen, {
      id: url,
      name: label?.trim() || fileNameOf(url),
      url,
      kind: artifactKind(undefined, url),
    });
  }
  const bare = /https?:\/\/[^\s<>()"'\]]+/g;
  for (const match of reply.matchAll(bare)) {
    const url = match[0].replace(/[.,;:]+$/, "");
    if (!isFileUrl(url)) continue;
    pushArtifact(target, seen, {
      id: url,
      name: fileNameOf(url),
      url,
      kind: artifactKind(undefined, url),
    });
  }
}

export function collectArtifacts(
  reply: string,
  payload: readonly { name?: string; url?: string; mime?: string; size?: number }[] = [],
): Artifact[] {
  const target: Artifact[] = [];
  const seen = new Set<string>();
  fromPayload(payload, target, seen);
  fromMarkdown(reply, target, seen);
  return target;
}
