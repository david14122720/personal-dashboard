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

import { filesUrl, removeWholePath, scanMediaPaths } from "./paths";

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
/** Same-origin file server (spec S9/S11): `/files/<absolute path>`. */
const FILES_URL_PREFIX = "/files/";

export function isMediaUrl(url: string): boolean {
  return url.startsWith(MEDIA_URL_PREFIX);
}

/**
 * A same-origin `/files/<absolute path>` address (owner spec S9/S11).
 *
 * The Rust proxy serves it from the allowlisted roots. A `..` *segment* is
 * refused here too, so a crafted path never becomes a link or an image;
 * `v1..png` is a file name, not traversal (B-006).
 */
export function isFilesUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed.startsWith(FILES_URL_PREFIX)) return false;
  // `/files//etc/passwd` would resolve outside the mount.
  if (trimmed.startsWith(`${FILES_URL_PREFIX}/`)) return false;
  return !hasTraversalSegment(trimmed.split(/[?#]/, 1)[0]);
}

/** A whole `..` segment is traversal; `v1..png` is just a file name. */
function hasTraversalSegment(pathname: string): boolean {
  let decoded = pathname;
  try {
    // `..%2F..` hides the separators inside one segment: decode before splitting.
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape cannot smuggle a whole `..` segment past the split.
  }
  return decoded.split(/[/\\]/).some((segment) => segment === "..");
}

/** Add the `download=` parameter that makes the proxy force an attachment. */
export function downloadUrl(url: string, name: string): string {
  const trimmed = url.trim();
  if (isMediaUrl(trimmed)) return `${trimmed}&download=${encodeURIComponent(name)}`;
  if (isFilesUrl(trimmed)) {
    const separator = trimmed.includes("?") ? "&" : "?";
    return `${trimmed}${separator}download=${encodeURIComponent(name)}`;
  }
  return url;
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
  // The Rust file server is same-origin and allowlisted; a `..` segment never
  // becomes a card (the backend rejects it before touching disk as well).
  if (isFilesUrl(trimmed)) return true;
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

/**
 * `true` when the value carries address syntax, so `#`/`?` open a fragment or
 * a query. A raw filesystem path is not an address: `a#b.png` is one file
 * name (B-007). The same-origin mounts count as addresses because a signed
 * media link keeps its path in the query string.
 */
function isAddress(value: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    value.startsWith("//") ||
    value.startsWith("/api/") ||
    value.startsWith("/files/")
  );
}

/** The last segment: an address drops its query/fragment first, a path not. */
function lastSegment(value: string): string {
  return (isAddress(value) ? pathOf(value) : value).split("/").pop() ?? "";
}

export function extensionOf(url: string): string {
  const tail = lastSegment(url);
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
  // The name comes from the raw path, never from the encoded URL (B-007):
  // `informe#1.pdf` is one file name, not `informe` plus a fragment.
  const tail = lastSegment(url);
  if (!tail) return fallback;
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}

/**
 * Payload items for the absolute paths a reply mentions (spec S9/S11).
 *
 * Each card points at the stable `/files/<path>` address the Rust file server
 * serves, so it survives a reload and works without a signing round-trip.
 * Registering the `path` also makes `collectArtifacts` remove it from the prose
 * wherever it appears, so no raw `/opt/data/...` survives next to its card.
 */
export function pathArtifacts(
  text: string,
): { name: string; url: string; path: string }[] {
  return scanMediaPaths(text).map((path) => ({
    name: fileNameOf(path),
    url: filesUrl(path),
    path,
  }));
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
 * Rewrite the delivered paths `collectArtifacts` already turned into cards.
 *
 * Three shapes disappear: a Markdown link/image whose destination is a
 * delivered file, a whole line that is exactly the delivered path (with or
 * without the `MEDIA:` prefix), and any other occurrence — Hermes prints paths
 * mid-sentence too (owner decision L3). Code is documentation, not a duplicate
 * of the card: fenced blocks (```, ~~~, four backticks), indented blocks and
 * inline backtick spans stay byte for byte.
 */
function stripPathsFromLine(line: string, delivered: Map<string, Artifact>): string {
  // Without a delivered path the line is untouched, byte for byte.
  if (delivered.size === 0) return line;
  // Odd indexes are the code spans captured by the split: leave them alone.
  const pieces = line.split(/(`+[^`]*`+)/g);
  const stripped = pieces.map((piece, index) => {
    if (index % 2 === 1) return piece;
    let prose = piece;
    for (const path of delivered.keys()) {
      // Only whole tokens go (B-008): `split/join` also deleted the shared
      // prefix of a longer file name (`/tmp/render.png.bak`) and of the
      // `path=` value in the app's own upload reference. The same boundary
      // rule `scanMediaPaths` applies decides which occurrence is a path.
      // The protocol prefix travels with the path it announces.
      prose = removeWholePath(prose, `MEDIA:${path}`);
      prose = removeWholePath(prose, path);
    }
    // Removing a mid-sentence path leaves the two halves' padding behind.
    return prose.replace(/[ \t]{2,}/g, " ");
  });
  return stripped.join("").trimEnd();
}

/** Line walker: fence tracking, whole-line cards and prose rewriting. */
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
      return [stripPathsFromLine(line.replace("MEDIA:", ""), delivered)];
    }
    return [stripPathsFromLine(line, delivered)];
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
    // A `data:` payload is drawn inline by the message body (see
    // `inline-images.ts`); carding it too would show every picture twice.
    if (url.startsWith("data:")) continue;
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
