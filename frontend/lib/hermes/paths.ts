/**
 * Universal path interceptor (ODD `hermes-rutas-descargas`, S2).
 *
 * Hermes mentions files it left on disk: `MEDIA:/opt/data/x.mp4`, a bare
 * `/opt/data/documentos_generados/x.pdf`, or a `/tmp` render. The proxy signs
 * the ones it detects while composing the reply; this scanner catches any it
 * missed (inside code blocks, older answers, tool output) so the UI can ask
 * for a signed URL and draw a card instead of dead text.
 */

const EXTENSIONS = [
  "mp4", "webm", "mov", "m4v", "mkv",
  "mp3", "wav", "ogg", "oga", "opus", "m4a", "flac", "aac",
  "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "ico",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "odt", "ods", "odp", "csv", "tsv", "txt", "md", "json", "yaml", "yml", "log",
  // Multi-part archives first so `.tar.gz` is not captured as `.tar`.
  "tar.gz", "tar.bz2", "zip", "tar", "gz", "tgz", "7z", "rar",
].join("|");

/**
 * Absolute paths under the two roots the proxy serves, with a media suffix.
 *
 * The rule is one whole token, shared by the scanner and the prose stripper:
 *
 * - Left boundary: a path starts a token, never inside a word, a deeper tree
 *   or a URL query (`?path=/opt/data/x.png` carries the path as a value, not
 *   as a bare path).
 * - Right boundary: the token ends at whitespace, a closing character or prose
 *   punctuation. A dot only ends it when no token character follows, so
 *   `/tmp/render.png.bak` is a different, longer token (B-008) while
 *   `/opt/data/x.docx.` still ends at the sentence's period.
 */
const TOKEN_LEFT = "(?<![\\w.\\/=&?%#-])";
const TOKEN_RIGHT = "(?=$|[\\s)\\]}\"'`<>,;:!?]|\\.+(?![.\\w-]))";

const PATH_PATTERN = new RegExp(
  `${TOKEN_LEFT}(?:MEDIA:)?((?:\\/opt\\/data|\\/tmp)\\/[^\\s)\\]}"'\`<>]+?\\.(?:${EXTENSIONS}))${TOKEN_RIGHT}`,
  "gi",
);

const MAX_PATHS = 32;

/**
 * Stable address for a file mentioned by path (owner spec S9/S11).
 *
 * The Rust proxy serves `/files/<absolute path>` from the same allowlisted
 * roots, with a real 404 for a miss and `Content-Disposition: attachment` for
 * documents. Unlike the signed `/api/hermes/media` link this address never
 * expires, so a card keeps working after a reload and can be pasted into a
 * browser or fetched by the agent itself.
 */
export function filesUrl(path: string): string {
  // Percent-encode each segment: a raw `#` or `?` in a file name would start a
  // fragment or a query and truncate the path the server receives (B-007).
  // Only the separators stay literal.
  const absolute = path.startsWith("/") ? path : `/${path}`;
  return `/files${absolute
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

/** A character that continues a token rather than separating two of them. */
const TOKEN_CHAR = /[\w./=&?%#-]/;
/** The right half of the same rule, anchored on the remainder of the line. */
const RIGHT_BOUNDARY = /^(?:$|[\s)\]}"'`<>,;:!?]|\.+(?![.\w-]))/;

/**
 * `true` when `text.slice(index, index + length)` is a whole token under the
 * boundary rule `scanMediaPaths` enforces: preceded by a non-token character
 * and not followed by one. The prose stripper removes exactly these
 * occurrences, so a delivered `/tmp/render.png` never eats the prefix of
 * `/tmp/render.png.bak` or the `path=` value of the app's own upload link.
 */
export function isWholePathAt(text: string, index: number, length: number): boolean {
  if (index < 0 || length === 0 || index + length > text.length) return false;
  if (index > 0 && TOKEN_CHAR.test(text[index - 1])) return false;
  return RIGHT_BOUNDARY.test(text.slice(index + length));
}

/** Indexes of every whole-token occurrence of `path` in `text`. */
function wholePathOffsets(text: string, path: string): number[] {
  const offsets: number[] = [];
  if (path.length === 0) return offsets;
  let index = text.indexOf(path);
  while (index >= 0) {
    if (isWholePathAt(text, index, path.length)) {
      offsets.push(index);
      index = text.indexOf(path, index + path.length);
    } else {
      index = text.indexOf(path, index + 1);
    }
  }
  return offsets;
}

/** `text` with every whole-token occurrence of `path` removed. */
export function removeWholePath(text: string, path: string): string {
  const offsets = wholePathOffsets(text, path);
  if (offsets.length === 0) return text;
  let stripped = "";
  let cursor = 0;
  for (const offset of offsets) {
    stripped += text.slice(cursor, offset);
    cursor = offset + path.length;
  }
  return stripped + text.slice(cursor);
}

/** Deduplicated absolute paths mentioned in `text`, in first-seen order. */
export function scanMediaPaths(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(PATH_PATTERN)) {
    const path = match[1];
    if (!path || found.includes(path)) continue;
    found.push(path);
    if (found.length >= MAX_PATHS) break;
  }
  return found;
}
