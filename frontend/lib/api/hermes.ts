/**
 * Hermes chat transport. The browser only ever calls the dashboard backend
 * (`/api/hermes`); `HERMES_API_KEY` never exists in the client bundle, so it
 * cannot leak through devtools or the network panel.
 *
 * Turns without attachments stay JSON (the proxy's original contract). Turns
 * with files travel as `multipart/form-data` (`message` + repeated `files`),
 * because file bytes do not belong in a base64 JSON string.
 */

import { apiBaseUrl, getToken } from "@/lib/api/client";

export type HermesErrorCode =
  | "timeout"
  | "unauthorized"
  | "session_expired"
  | "too_long"
  | "too_large"
  | "too_many_attachments"
  | "unavailable"
  | "upstream"
  | "network"
  | "invalid_response";

export class HermesError extends Error {
  readonly code: HermesErrorCode;
  readonly status?: number;

  constructor(code: HermesErrorCode, message: string, status?: number) {
    super(message);
    this.name = "HermesError";
    this.code = code;
    this.status = status;
  }
}

export interface HermesArtifact {
  name: string;
  url: string;
  mime?: string;
  size?: number;
  /** Absolute server path, present for signed `/api/hermes/media` URLs. */
  path?: string;
}

export interface HermesReply {
  reply: string;
  artifacts: HermesArtifact[];
  warnings: string[];
}

export interface HermesTurn {
  content: string;
  files?: readonly File[];
}

/** One `event: hermes.tool.progress` frame, kept opaque for the UI. */
export interface HermesToolEvent {
  tool: string;
  label?: string;
  emoji?: string;
  status?: string;
  toolCallId?: string;
}

export interface HermesStreamHandlers {
  /** Upstream budget reported by the proxy; the UI uses it for the banner. */
  onStart?: (timeoutMs: number) => void;
  onThinking?: (text: string) => void;
  onTool?: (tool: HermesToolEvent) => void;
  onDelta?: (text: string) => void;
}

interface SseFrame {
  event: string;
  data: string;
}

interface HermesChoice {
  message?: { content?: unknown };
}

interface HermesResponse {
  reply?: unknown;
  artifacts?: unknown;
  warnings?: unknown;
  reasoning?: unknown;
  choices?: HermesChoice[];
}

function codeForUpstream(upstreamCode: string | undefined): HermesErrorCode {
  switch (upstreamCode) {
    case "HERMES_TIMEOUT":
      return "timeout";
    case "HERMES_UNAUTHORIZED":
      return "unauthorized";
    case "HERMES_UNAVAILABLE":
      return "unavailable";
    case "HERMES_UPSTREAM_ERROR":
      return "upstream";
    case "TOO_MANY_ATTACHMENTS":
      return "too_many_attachments";
    case "PAYLOAD_TOO_LARGE":
      return "too_large";
    default:
      return "upstream";
  }
}

function codeForStatus(status: number, upstreamCode?: string): HermesErrorCode {
  if (upstreamCode === "TOO_MANY_ATTACHMENTS") return "too_many_attachments";
  if (
    upstreamCode === "ATTACHMENT_TOO_LARGE" ||
    upstreamCode === "ATTACHMENTS_TOO_LARGE" ||
    upstreamCode === "PAYLOAD_TOO_LARGE"
  ) {
    return "too_large";
  }
  if (status === 401) {
    // The proxy answers HERMES_UNAUTHORIZED when the *server's* key is wrong;
    // a plain UNAUTHORIZED means the dashboard session expired.
    return upstreamCode === "HERMES_UNAUTHORIZED" ? "unauthorized" : "session_expired";
  }
  if (status === 413) return "too_large";
  if (status === 422) return "too_long";
  if (status === 504) return "timeout";
  if (status === 502 || status === 503) return "unavailable";
  return "upstream";
}

function artifactsOf(raw: unknown): HermesArtifact[] {
  if (!Array.isArray(raw)) return [];
  const out: HermesArtifact[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.url !== "string") continue;
    out.push({
      url: candidate.url,
      name: typeof candidate.name === "string" ? candidate.name : candidate.url,
      mime: typeof candidate.mime === "string" ? candidate.mime : undefined,
      size: typeof candidate.size === "number" ? candidate.size : undefined,
      path: typeof candidate.path === "string" ? candidate.path : undefined,
    });
  }
  return out;
}

function warningsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

/** Headers and body shared by the JSON and the stream transports. */
function buildTurn(
  sessionId: string,
  turn: HermesTurn,
  accept?: string,
): { headers: Record<string, string>; body: BodyInit } {
  const token = getToken();
  const headers: Record<string, string> = { "X-Hermes-Session-Id": sessionId };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (accept) headers.Accept = accept;

  const files = turn.files ?? [];
  let body: BodyInit;
  if (files.length === 0) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ messages: [{ role: "user", content: turn.content }] });
  } else {
    const form = new FormData();
    form.append("message", turn.content);
    for (const file of files) form.append("files", file, file.name);
    body = form;
  }
  return { headers, body };
}

function errorFromResponse(status: number, text: string): HermesError {
  let upstreamCode: string | undefined;
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown } };
    if (typeof parsed.error?.code === "string") upstreamCode = parsed.error.code;
  } catch {
    // Non-JSON error body: status still decides.
  }
  return new HermesError(
    codeForStatus(status, upstreamCode),
    `hermes status ${status}`,
    status,
  );
}

function parseSseFrame(raw: string): SseFrame {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return { event, data: data.join("\n") };
}

function replyFromEnvelope(data: string): HermesReply {
  let parsed: HermesResponse;
  try {
    parsed = JSON.parse(data) as HermesResponse;
  } catch {
    throw new HermesError("invalid_response", "hermes returned an unreadable event");
  }
  const reply = typeof parsed.reply === "string" ? parsed.reply : "";
  const artifacts = artifactsOf(parsed.artifacts);
  // A thinking-only turn is still a valid answer: the accordion carries it.
  const reasoned = typeof parsed.reasoning === "string" && parsed.reasoning.trim().length > 0;
  if (reply.trim().length === 0 && artifacts.length === 0 && !reasoned) {
    throw new HermesError("invalid_response", "hermes returned no message content");
  }
  return { reply, artifacts, warnings: warningsOf(parsed.warnings) };
}

/**
 * Send exactly the current user turn. History is intentionally NOT sent: the
 * Hermes server keeps the conversation memory under `sessionId`.
 */
export async function sendHermesTurn(
  sessionId: string,
  turn: HermesTurn,
): Promise<HermesReply> {
  const { headers, body } = buildTurn(sessionId, turn);
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/hermes`, { method: "POST", headers, body });
  } catch {
    throw new HermesError("network", "network error");
  }

  const text = await res.text();
  if (!res.ok) throw errorFromResponse(res.status, text);

  let data: HermesResponse;
  try {
    data = JSON.parse(text) as HermesResponse;
  } catch {
    throw new HermesError("invalid_response", "hermes returned a non-JSON response");
  }

  // Envelope from the Rust proxy, with the legacy upstream shape as fallback.
  const reply =
    typeof data.reply === "string"
      ? data.reply
      : isLegacyContent(data.choices?.[0]?.message?.content)
        ? data.choices![0].message!.content
        : undefined;

  const artifacts = artifactsOf(data.artifacts);
  const replyText = typeof reply === "string" ? reply : "";
  if (replyText.trim().length === 0 && artifacts.length === 0) {
    throw new HermesError("invalid_response", "hermes returned no message content");
  }

  return { reply: replyText, artifacts, warnings: warningsOf(data.warnings) };
}

function isLegacyContent(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Ask the proxy to sign paths the reply still mentions. Authenticated with the
 * dashboard session (unlike the media route itself, which uses the signature).
 * Unknown or unreadable paths are dropped by the backend, so the caller gets
 * only cards that can actually download.
 */
export async function signHermesMedia(
  paths: readonly string[],
  timeoutMs = 5_000,
): Promise<HermesArtifact[]> {
  if (paths.length === 0) return [];
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  // The reply is already streamed; an unanswered sign request must cost the
  // extra cards, never the turn. The timer covers the body too: a proxy that
  // sends headers and then stalls is as bad as one that never answers.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(`${apiBaseUrl()}/hermes/media/sign`, {
        method: "POST",
        headers,
        body: JSON.stringify({ paths: [...paths] }),
        signal: controller.signal,
      });
    } catch {
      throw new HermesError("network", "network error");
    }
    if (!res.ok) throw errorFromResponse(res.status, await res.text());
    let data: { items?: unknown };
    try {
      data = (await res.json()) as { items?: unknown };
    } catch {
      throw new HermesError("invalid_response", "hermes returned an unreadable response");
    }
    return artifactsOf(data.items);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Same turn, incremental: the proxy answers `text/event-stream` with
 * `start`/`thinking`/`tool`/`delta`/`done`/`error`. Resolves with the final
 * envelope, exactly like [`sendHermesTurn`], so callers keep one shape.
 *
 * No timeout of its own: a heavy Hermes turn may legitimately run for minutes.
 * The caller owns the `AbortController` (the banner's "Reintentar" aborts it).
 */
export async function sendHermesTurnStream(
  sessionId: string,
  turn: HermesTurn,
  handlers: HermesStreamHandlers = {},
  signal?: AbortSignal,
): Promise<HermesReply> {
  const { headers, body } = buildTurn(sessionId, turn, "text/event-stream");
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/hermes`, { method: "POST", headers, body, signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new HermesError("network", "network error");
  }

  if (!res.ok) throw errorFromResponse(res.status, await res.text());
  if (!res.body) throw new HermesError("invalid_response", "hermes returned no stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: HermesReply | null = null;

  const handle = (raw: string): void => {
    if (!raw.trim()) return;
    const { event, data } = parseSseFrame(raw);
    switch (event) {
      case "start": {
        try {
          const parsed = JSON.parse(data) as { timeoutMs?: unknown };
          if (typeof parsed.timeoutMs === "number") handlers.onStart?.(parsed.timeoutMs);
        } catch {
          // A malformed start frame only costs the banner threshold.
        }
        return;
      }
      case "thinking": {
        try {
          const parsed = JSON.parse(data) as { text?: unknown };
          if (typeof parsed.text === "string" && parsed.text) handlers.onThinking?.(parsed.text);
        } catch {
          // Skip unreadable frames instead of killing the turn.
        }
        return;
      }
      case "tool": {
        try {
          const parsed = JSON.parse(data) as HermesToolEvent;
          if (typeof parsed.tool === "string") handlers.onTool?.(parsed);
        } catch {
          // Same: a broken progress frame is cosmetic.
        }
        return;
      }
      case "delta": {
        try {
          const parsed = JSON.parse(data) as { text?: unknown };
          if (typeof parsed.text === "string" && parsed.text) handlers.onDelta?.(parsed.text);
        } catch {
          // Ignore.
        }
        return;
      }
      case "done":
        result = replyFromEnvelope(data);
        return;
      case "error": {
        let code: string | undefined;
        try {
          const parsed = JSON.parse(data) as { code?: unknown };
          if (typeof parsed.code === "string") code = parsed.code;
        } catch {
          // Fall through with the generic code.
        }
        throw new HermesError(codeForUpstream(code), "hermes stream error");
      }
      default:
        return;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        handle(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handle(buffer);
  } finally {
    reader.releaseLock();
  }

  if (!result) {
    throw new HermesError("invalid_response", "hermes closed the stream without a reply");
  }
  return result;
}
