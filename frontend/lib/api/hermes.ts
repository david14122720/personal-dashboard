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

interface HermesChoice {
  message?: { content?: unknown };
}

interface HermesResponse {
  reply?: unknown;
  artifacts?: unknown;
  warnings?: unknown;
  choices?: HermesChoice[];
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
    });
  }
  return out;
}

function warningsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

/**
 * Send exactly the current user turn. History is intentionally NOT sent: the
 * Hermes server keeps the conversation memory under `sessionId`.
 */
export async function sendHermesTurn(
  sessionId: string,
  turn: HermesTurn,
): Promise<HermesReply> {
  const token = getToken();
  const headers: Record<string, string> = { "X-Hermes-Session-Id": sessionId };
  if (token) headers.Authorization = `Bearer ${token}`;

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

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/hermes`, { method: "POST", headers, body });
  } catch {
    throw new HermesError("network", "network error");
  }

  const text = await res.text();
  if (!res.ok) {
    let upstreamCode: string | undefined;
    try {
      const parsed = JSON.parse(text) as { error?: { code?: unknown } };
      if (typeof parsed.error?.code === "string") upstreamCode = parsed.error.code;
    } catch {
      // Non-JSON error body: status still decides.
    }
    throw new HermesError(
      codeForStatus(res.status, upstreamCode),
      `hermes status ${res.status}`,
      res.status,
    );
  }

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
