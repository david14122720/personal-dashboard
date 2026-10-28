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

/** Absolute paths under the two roots the proxy serves, with a media suffix. */
const PATH_PATTERN = new RegExp(
  // The lookbehind rejects paths embedded in URLs or deeper trees
  // (`https://x/tmp/a.png`, `/var/tmp/a.png`).
  `(?<![\\w.\\/-])(?:MEDIA:)?((?:\\/opt\\/data|\\/tmp)\\/[^\\s)\\]}"'\`<>]+?\\.(?:${EXTENSIONS}))(?=$|[\\s)\\]}"'\`<>,.;:!?])`,
  "gi",
);

const MAX_PATHS = 32;

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
