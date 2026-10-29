/**
 * Inline images for agent replies.
 *
 * Hermes answers with `![image](data:image/png;base64,…)` when it renders a
 * picture. Feeding that string to the Markdown renderer would either show a
 * wall of base64 or (worse) let the model decide what the DOM contains, so the
 * reply is split into ordered segments first: prose keeps going through
 * `react-markdown`, and a validated payload becomes a real `<img>` element
 * built by React (never `innerHTML`).
 *
 * Two rules shape the parser:
 *
 * 1. **Accumulated text only.** The caller passes the whole message so far, so
 *    a payload that is only half received can never be mistaken for a picture.
 *    While the closing `)` (Markdown) or the end of the settled message is
 *    missing, the segment is `pending` and the partial base64 is hidden from
 *    the transcript instead of being printed.
 * 2. **Allowlist, not pattern matching.** Only `png`, `jpeg`/`jpg`, `gif` and
 *    `webp` payloads become images. `image/svg+xml` stays text (SVG is a script
 *    container), and every other MIME is left byte for byte.
 *
 * Payloads inside a fenced code block are documentation, not pictures: those
 * ranges are computed first and skipped.
 */
export type InlineSegment =
  | { type: "text"; value: string }
  | { type: "image"; id: string; src: string; alt: string }
  /** A payload that has not finished arriving: render a discreet placeholder. */
  | { type: "pending"; id: string }
  /** A payload beyond the render budget: keep the transcript, drop the bytes. */
  | { type: "oversized"; id: string };

/** Encoded characters, not decoded bytes: base64 grows 4/3. ~6 MB of image. */
export const MAX_INLINE_IMAGE_CHARS = 8 * 1024 * 1024;

/** Below this a "payload" is a documentation example, not a picture. */
const MIN_INLINE_IMAGE_CHARS = 64;

const IMAGE_MIME = /image\/(png|jpe?g|gif|webp)/i;

/** Complete Markdown image whose destination is a supported data payload. */
const MARKDOWN_PAYLOAD =
  /!\[([^\]\n]{0,200})\]\(\s*(data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+?)\s*\)/gi;

/** Any data payload, complete or still streaming. */
const BARE_PAYLOAD = /data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]*/gi;

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** Half-open character ranges covered by fenced code blocks. */
function fencedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  let open: { mark: string; size: number; start: number } | null = null;
  for (const line of text.split("\n")) {
    const lineEnd = offset + line.length;
    const match = FENCE.exec(line);
    if (match) {
      const run = match[1];
      if (open === null) open = { mark: run[0], size: run.length, start: offset };
      else if (open.mark === run[0] && run.length >= open.size) {
        ranges.push([open.start, lineEnd]);
        open = null;
      }
    }
    offset = lineEnd + 1;
  }
  if (open !== null) ranges.push([open.start, text.length]);
  return ranges;
}

function insideFence(index: number, ranges: ReadonlyArray<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function normalizePayload(payload: string): string | null {
  const comma = payload.indexOf(",");
  if (comma === -1) return null;
  const header = payload.slice(0, comma).toLowerCase();
  const data = payload.slice(comma + 1).replace(/\s+/g, "");
  const mime = /^data:(image\/[a-z]+);base64$/.exec(header)?.[1] ?? "";
  if (!IMAGE_MIME.test(mime)) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(data)) return null;
  if (data.length < MIN_INLINE_IMAGE_CHARS) return null;
  return `data:${mime};base64,${data}`;
}

/**
 * The only sources allowed to become an `<img>` inside rendered Markdown.
 *
 * Two shapes and nothing else: a validated raster data payload (SVG excluded,
 * it is a script container) and the proxy's own signed media URL, which needs
 * `path`, `exp` and `sig` — a bare `?path=` is never a picture. Remote URLs
 * stay blocked so agent output cannot beacon to a third party.
 */
export function safeImageSource(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (value.length === 0) return null;
  if (value.startsWith("/api/hermes/media?")) {
    const params = new URLSearchParams(value.slice(value.indexOf("?") + 1));
    const path = params.get("path");
    const sig = params.get("sig");
    const exp = params.get("exp");
    if (!path || !sig || !exp) return null;
    if (!path.startsWith("/")) return null;
    return value;
  }
  if (!value.startsWith("data:image/")) return null;
  const src = normalizePayload(value);
  if (src === null || src.length > MAX_INLINE_IMAGE_CHARS) return null;
  return src;
}

interface Candidate {
  start: number;
  end: number;
  payload: string;
  alt: string;
  complete: boolean;
}

/**
 * Split accumulated reply text into prose and images.
 *
 * `final` must be false while the reply is still streaming: it is what allows
 * a bare trailing payload (no closing `)`) to be treated as incomplete instead
 * of rendered from its first chunk.
 */
export function splitInlineImages(
  text: string,
  options: { final?: boolean } = {},
): InlineSegment[] {
  const final = options.final === true;
  // Fast path: prose without a payload cannot contain an inline image, and the
  // scan below walks every character of the accumulated text on each ~60 ms
  // flush. The common case (a reply with no picture) must stay a substring check.
  if (!text.includes("data:image/")) return [{ type: "text", value: text }];
  const fences = fencedRanges(text);
  const candidates: Candidate[] = [];

  MARKDOWN_PAYLOAD.lastIndex = 0;
  for (let match = MARKDOWN_PAYLOAD.exec(text); match; match = MARKDOWN_PAYLOAD.exec(text)) {
    if (insideFence(match.index, fences)) continue;
    candidates.push({
      start: match.index,
      end: match.index + match[0].length,
      payload: match[2],
      alt: match[1].trim(),
      complete: true,
    });
  }

  BARE_PAYLOAD.lastIndex = 0;
  for (let match = BARE_PAYLOAD.exec(text); match; match = BARE_PAYLOAD.exec(text)) {
    if (insideFence(match.index, fences)) continue;
    // A payload already consumed by the Markdown shape is not a second image.
    if (candidates.some((seen) => match.index >= seen.start && match.index < seen.end)) continue;
    const end = match.index + match[0].length;
    // The regex is greedy over base64 characters, so anything after `end` is
    // already a terminator. Only a payload at the very end of a still-streaming
    // message may be half received.
    const complete = final || end < text.length;
    candidates.push({
      start: match.index,
      end,
      payload: match[0],
      alt: "",
      complete,
    });
  }

  candidates.sort((a, b) => a.start - b.start);

  const segments: InlineSegment[] = [];
  let counter = 0;
  const nextId = () => {
    counter += 1;
    return `inline-${counter}`;
  };
  let cursor = 0;

  for (const candidate of candidates) {
    if (candidate.start < cursor) continue;
    if (candidate.start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, candidate.start) });
    }
    cursor = candidate.end;
    if (!candidate.complete) {
      // An incomplete payload has no natural size bound: the reply is rescanned
      // on every ~60 ms flush, so keeping an unbounded `pending` segment makes
      // the cost quadratic (measured: ~19 ms per flush at the 8 MB cap). Past
      // the cap the payload can never render, so drop it now instead of
      // carrying it to the end of the reply. A stateful incremental parser
      // would remove the repeated scan; that is a later round, not this one.
      if (candidate.payload.length > MAX_INLINE_IMAGE_CHARS) {
        segments.push({ type: "oversized", id: nextId() });
      } else {
        segments.push({ type: "pending", id: nextId() });
      }
      continue;
    }
    const src = normalizePayload(candidate.payload);
    if (src === null) {
      // Not a supported payload (SVG, an example): leave it exactly as written.
      segments.push({ type: "text", value: text.slice(candidate.start, candidate.end) });
      continue;
    }
    if (src.length > MAX_INLINE_IMAGE_CHARS) {
      segments.push({ type: "oversized", id: nextId() });
      continue;
    }
    segments.push({ type: "image", id: nextId(), src, alt: candidate.alt });
  }

  if (cursor < text.length) segments.push({ type: "text", value: text.slice(cursor) });
  if (segments.length === 0) segments.push({ type: "text", value: "" });
  return segments;
}
