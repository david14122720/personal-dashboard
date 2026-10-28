/**
 * Files Hermes delivers inside a reply.
 *
 * Three sources, one shape: the proxy's `artifacts` array (signed media URLs
 * for files it can see on disk), `MEDIA:/abs/path` tags and bare absolute
 * paths the agent prints in prose, plus plain links in Markdown. Remote files
 * are never auto-loaded: only embedded `data:` payloads preview inline, so a
 * model-authored URL cannot beacon on render.
 *
 * Signed media URLs are relative to this origin and carry a short-lived
 * signature, because `<video>`/`<audio>`/`<img>` cannot send the session
 * bearer. Everything else keeps the explicit open/download behaviour.
 */

export type ArtifactKind = "image" | "audio" | "video" | "code" | "document" | "file";

/** Icon/badge family, derived from the extension the agent delivered. */
export type DocumentFamily =
  | "word"
  | "excel"
  | "powerpoint"
  | "pdf"
  | "archive"
  | "text"
  | "other";

export interface Artifact {
  id: string;
  name: string;
  url: string;
  mime?: string;
  size?: number;
  kind: ArtifactKind;
  /** Absolute server path, when the proxy reported one. */
  path?: string;
}

export interface CollectedArtifacts {
  artifacts: Artifact[];
  /** The reply with every delivered path replaced by its card. */
  text: string;
}

const MEDIA_URL_PREFIX = "/api/hermes/media?";

export function isMediaUrl(url: string): boolean {
  return url.startsWith(MEDIA_URL_PREFIX);
}

/** Add the `download=` parameter that makes the proxy force an attachment. */
export function downloadUrl(url: string, name: string): string {
  if (!isMediaUrl(url)) return url;
  return `${url}&download=${encodeURIComponent(name)}`;
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
  ods: "document", odp: "document",
  zip: "document", tar: "document", gz: "document", rar: "document",
  "7z": "document",
};

const FAMILY_BY_EXT: Record<string, DocumentFamily> = {
  doc: "word", docx: "word", odt: "word",
  xls: "excel", xlsx: "excel", ods: "excel", csv: "excel",
  ppt: "powerpoint", pptx: "powerpoint", odp: "powerpoint",
  pdf: "pdf",
  zip: "archive", tar: "archive", gz: "archive", rar: "archive", "7z": "archive",
  txt: "text", md: "text", json: "text", log: "text",
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
/** Embedded payloads and same-origin signed media are safe to render. */
export function isEmbeddedUrl(url: string): boolean {
  return url.startsWith("data:");
}

export function isSafeArtifactUrl(url: string): boolean {
  const trimmed = url.trim();
  if (isMediaUrl(trimmed)) return true;
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

/** The real file path: explicit `path`, the `?path=` parameter, or the URL. */
export function artifactPathOf(artifact: Pick<Artifact, "url" | "path">): string {
  if (artifact.path) return artifact.path;
  if (isMediaUrl(artifact.url)) {
    const query = artifact.url.slice(artifact.url.indexOf("?") + 1);
    const parsed = new URLSearchParams(query).get("path");
    if (parsed) return parsed;
  }
  return artifact.url;
}

export function artifactExtension(artifact: Pick<Artifact, "url" | "path">): string {
  return extensionOf(artifactPathOf(artifact));
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
  const declared = url.startsWith("data:")
    ? (/^data:([^;,]+)/.exec(url)?.[1] ?? "").toLowerCase()
    : "";
  const normalized = (mime ?? declared).toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("audio/")) return "audio";
  if (normalized.startsWith("video/")) return "video";
  if (normalized === "application/pdf") return "document";
  if (normalized.startsWith("text/")) return "code";
  if (normalized) return "document";
  return EXTENSION_KIND[extensionOf(url)] ?? "file";
}

export function documentFamily(artifact: Pick<Artifact, "url" | "path" | "mime">): DocumentFamily {
  const mime = (artifact.mime ?? "").toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "other";
  const ext = artifactExtension(artifact);
  const family = FAMILY_BY_EXT[ext];
  if (family) return family;
  if (mime.startsWith("text/")) return "text";
  return "other";
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

/**
 * Replace the references the proxy already turned into cards.
 *
 * Only two shapes are rewritten: a Markdown link/image whose destination is a
 * delivered file, and a whole line that is exactly the delivered path (with or
 * without the `MEDIA:` prefix) — that is how the gateway prints them. Everything
 * else, including any mention of the same path inside code (fenced with ```,
 * ~~~, four backticks or four spaces), is left byte for byte: it is
 * documentation, not a duplicate of the card.
 */
function stripDeliveredPaths(reply: string, delivered: Map<string, Artifact>): string {
  // A link whose destination contains a delivered path loses its whole shape,
  // including titles, angle brackets, images and query strings.
  const withoutLinks = reply.replace(/!?\[[^\]]*\]\(([^)]*)\)[ \t]?/g, (match, destination: string) => {
    for (const path of delivered.keys()) {
      if (destination.includes(path)) return "";
    }
    return match;
  });

  // Fence tracking: a whole line that is a path inside a code block is
  // documentation, not a duplicate card, and must stay byte for byte.
  let fence: { mark: string; size: number } | null = null;
  const lines = withoutLinks.split("\n").flatMap((line) => {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const run = fenceMatch[1];
      // A fence closes only with the same character and at least the same
      // length: a 4-backtick block may contain 3-backtick lines.
      if (fence === null) fence = { mark: run[0], size: run.length };
      else if (fence.mark === run[0] && run.length >= fence.size) fence = null;
      return [line];
    }
    if (fence !== null) return [line];
    // Four spaces (or a tab) start an indented code block.
    if (/^(?: {4}|\t)/.test(line)) return [line];

    const trimmed = line.trim().replace(/[.,;:]+$/, "");
    const bare = trimmed.startsWith("MEDIA:")
      ? trimmed.slice("MEDIA:".length).trim()
      : trimmed;
    if (delivered.has(bare)) return [];
    // An uncarded MEDIA line keeps the honest path without the protocol prefix.
    if (trimmed.startsWith("MEDIA:") && bare.startsWith("/")) {
      return [line.replace("MEDIA:", "")];
    }
    return [line];
  });

  let text = lines.join("\n").trim();
  // Collapsing empty lines is cosmetic; never do it inside a code fence.
  if (!text.includes("```")) text = text.replace(/\n{3,}/g, "\n\n");
  return text;
}

function fromPayload(
  items: readonly { name?: string; url?: string; mime?: string; size?: number; path?: string }[],
  target: Artifact[],
  seen: Set<string>,
  delivered: Map<string, Artifact>,
) {
  for (const item of items) {
    if (!item?.url) continue;
    const url = item.url;
    const path = item.path ?? (isMediaUrl(url) ? new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("path") ?? undefined : undefined);
    const artifact: Artifact = {
      id: path ?? url,
      name: item.name?.trim() || (path ? fileNameOf(path) : fileNameOf(url)),
      url,
      mime: item.mime,
      size: item.size,
      kind: artifactKind(item.mime, path ?? url),
      path: path ?? undefined,
    };
    if (!isSafeArtifactUrl(artifact.url) || seen.has(artifact.id)) continue;
    seen.add(artifact.id);
    target.push(artifact);
    if (path) delivered.set(path, artifact);
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

/**
 * Build the cards for one reply and return the prose with those paths removed,
 * so a delivered file never also shows as raw `MEDIA:/opt/data/...` text.
 */
export function collectArtifacts(
  reply: string,
  payload: readonly { name?: string; url?: string; mime?: string; size?: number; path?: string }[] = [],
): CollectedArtifacts {
  const target: Artifact[] = [];
  const seen = new Set<string>();
  const delivered = new Map<string, Artifact>();

  fromPayload(payload, target, seen, delivered);
  const text = stripDeliveredPaths(reply, delivered);
  fromMarkdown(text, target, seen);

  return { artifacts: target, text };
}
