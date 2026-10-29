/**
 * Hermes Runs transport. The browser only ever calls the dashboard backend
 * (`/api/hermes/runs`); the Hermes gateway key never exists in the client
 * bundle, so it cannot leak through devtools or the network panel.
 *
 * One user turn = one run: `createHermesRun` starts it, `streamHermesRun`
 * replays its verbatim SSE events live, `getHermesRun` recovers it after a
 * page refresh, and `resolveHermesApproval` answers a security gate. The
 * browser never sends `X-Hermes-Session-Id`: the proxy owns the session
 * namespace (`pd-<user_id>-<uuid>`).
 *
 * Turns without attachments stay JSON (`{sessionId, message}`). Turns with
 * files travel as `multipart/form-data` (`sessionId`, `message`, repeated
 * `files`), because file bytes do not belong in a base64 JSON string.
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

export interface HermesTurn {
  content: string;
  files?: readonly File[];
}

/** One `tool.started`/`tool.completed` frame, kept opaque for the UI. */
export interface HermesToolEvent {
  tool: string;
  label?: string;
  emoji?: string;
  status?: string;
  toolCallId?: string;
}

export interface HermesRunCreated {
  runId: string;
  sessionId: string;
  /** Proxy clock, milliseconds since the epoch. */
  createdAt: number;
}

export interface HermesRunStatus {
  runId: string;
  status: string;
  createdAt: number;
  executionGeneration: number;
  output: string;
  error: string | null;
  pendingControls: unknown;
}

/** A verbatim gateway event payload: dispatch happens on `event`. */
export interface HermesRunEvent {
  event: string;
  [key: string]: unknown;
}

export interface HermesRunStreamHandlers {
  /** Every parsed payload, including terminal ones. */
  onEvent: (payload: HermesRunEvent) => void;
  /** Only `run.completed|run.failed|run.cancelled|run.interrupted`. */
  onTerminal: (payload: HermesRunEvent) => void;
}

export type HermesApprovalChoice = "once" | "deny" | "session" | "always";

export interface HermesApprovalResolution {
  requestId: string;
  executionGeneration: number;
  choice: HermesApprovalChoice;
}

/** Run states where re-subscribing to the SSE stream is still useful. */
const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "running",
  "waiting_for_approval",
  "stopping",
]);

export function isHermesRunActive(status: string): boolean {
  return ACTIVE_RUN_STATUSES.has(status);
}

const TERMINAL_RUN_EVENTS = new Set([
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.interrupted",
]);

export function isHermesRunTerminalEvent(event: string): boolean {
  return TERMINAL_RUN_EVENTS.has(event);
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

export function artifactsOf(raw: unknown): HermesArtifact[] {
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

export function warningsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
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

function errorText(raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim().length > 0) return raw;
  if (raw && typeof raw === "object") {
    const message = (raw as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim().length > 0) return message;
  }
  return null;
}

/**
 * Start exactly the current user turn as a run. History is intentionally NOT
 * sent: the Hermes server keeps the conversation memory under `sessionId`.
 * Resolves fast (`202`) with the run identity; the answer arrives over
 * [`streamHermesRun`].
 */
export async function createHermesRun(
  sessionId: string,
  turn: HermesTurn,
): Promise<HermesRunCreated> {
  const headers = authHeaders();
  const files = turn.files ?? [];
  let body: BodyInit;
  if (files.length === 0) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ sessionId, message: turn.content });
  } else {
    const form = new FormData();
    form.append("sessionId", sessionId);
    form.append("message", turn.content);
    for (const file of files) form.append("files", file, file.name);
    body = form;
  }

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/hermes/runs`, { method: "POST", headers, body });
  } catch {
    throw new HermesError("network", "network error");
  }
  if (!res.ok) throw errorFromResponse(res.status, await res.text());

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new HermesError("invalid_response", "hermes returned a non-JSON response");
  }
  if (typeof data.runId !== "string" || data.runId.length === 0) {
    throw new HermesError("invalid_response", "hermes returned no run id");
  }
  return {
    runId: data.runId,
    sessionId: typeof data.sessionId === "string" ? data.sessionId : sessionId,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
  };
}

/**
 * Follow one run live. The proxy reemits the gateway frames verbatim, so the
 * parser works on the payload, not on an `event:` line:
 *
 * - frames split on a blank line (CRLF normalized to LF first, so a
 *   CRLF-framed upstream cannot buffer the whole stream);
 * - every line starting with `:` is a comment (`: keepalive`, `: open`,
 *   `: stream closed`) and is ignored silently;
 * - `id:` lines are the server cursor and are ignored;
 * - `data:` lines are concatenated with `\n`, parsed as JSON, and dispatched
 *   on the payload's `event` field.
 *
 * No timeout of its own: a heavy run may legitimately take minutes. The
 * caller owns the `AbortController`.
 */
export async function streamHermesRun(
  runId: string,
  handlers: HermesRunStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/hermes/runs/${runId}/events`, {
      headers: { ...authHeaders(), Accept: "text/event-stream" },
      signal,
    });
  } catch (error) {
    // A DOMException is not an Error subclass: match the abort by name so a
    // caller-initiated cancel never surfaces as a network failure.
    if (isAbortError(error)) throw error;
    throw new HermesError("network", "network error");
  }

  if (!res.ok) throw errorFromResponse(res.status, await res.text());
  if (!res.body) throw new HermesError("invalid_response", "hermes returned no stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (raw: string): void => {
    const data: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith(":")) continue;
      else if (line.startsWith("id:")) continue;
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length === 0) return;
    let payload: HermesRunEvent;
    try {
      payload = JSON.parse(data.join("\n")) as HermesRunEvent;
    } catch {
      // Skip unreadable frames instead of killing the run.
      return;
    }
    if (!payload || typeof payload.event !== "string") return;
    handlers.onEvent(payload);
    if (isHermesRunTerminalEvent(payload.event)) handlers.onTerminal(payload);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // A CRLF-framed upstream (or intermediary) would otherwise never
      // contain `\n\n`: normalize before splitting so frames dispatch.
      if (buffer.includes("\r")) buffer = buffer.replace(/\r\n/g, "\n");
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        dispatch(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.includes("\r")) buffer = buffer.replace(/\r\n/g, "\n");
    if (buffer.trim()) dispatch(buffer);
  } finally {
    reader.releaseLock();
  }
}

/** Read back one run: used to re-attach after a page refresh. */
export async function getHermesRun(runId: string): Promise<HermesRunStatus> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/hermes/runs/${runId}`, {
      headers: authHeaders(),
    });
  } catch {
    throw new HermesError("network", "network error");
  }
  if (!res.ok) throw errorFromResponse(res.status, await res.text());

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new HermesError("invalid_response", "hermes returned a non-JSON response");
  }
  return {
    runId: typeof data.runId === "string" ? data.runId : runId,
    status: typeof data.status === "string" ? data.status : "unknown",
    createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
    executionGeneration:
      typeof data.executionGeneration === "number" ? data.executionGeneration : 0,
    output: typeof data.output === "string" ? data.output : "",
    error: errorText(data.error),
    pendingControls: data.pendingControls ?? null,
  };
}

/**
 * Answer a security gate. `requestId` carries the `prompt_id` of the
 * `approval.request` event and `executionGeneration` is copied from the same
 * event; the card only offers `once`/`deny`. The run resumes on its own.
 */
export async function resolveHermesApproval(
  runId: string,
  approval: HermesApprovalResolution,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/hermes/runs/${runId}/approval`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(approval),
    });
  } catch {
    throw new HermesError("network", "network error");
  }
  if (!res.ok) throw errorFromResponse(res.status, await res.text());
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
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
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
