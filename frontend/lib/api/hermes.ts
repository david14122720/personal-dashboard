/**
 * Hermes chat transport. The browser only ever calls the dashboard backend
 * (`/api/hermes`); `HERMES_API_KEY` never exists in the client bundle, so it
 * cannot leak through devtools or the network panel.
 */

import { apiBaseUrl, getToken } from "@/lib/api/client";

export type HermesErrorCode =
  | "timeout"
  | "unauthorized"
  | "session_expired"
  | "too_long"
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

interface HermesChoice {
  message?: { content?: unknown };
}

interface HermesResponse {
  choices?: HermesChoice[];
}

function codeForStatus(status: number, upstreamCode?: string): HermesErrorCode {
  if (status === 401) {
    // The proxy answers HERMES_UNAUTHORIZED when the *server's* key is wrong;
    // a plain UNAUTHORIZED means the dashboard session expired.
    return upstreamCode === "HERMES_UNAUTHORIZED" ? "unauthorized" : "session_expired";
  }
  if (status === 422) return "too_long";
  if (status === 504) return "timeout";
  if (status === 502 || status === 503) return "unavailable";
  return "upstream";
}

/**
 * Send exactly the current user turn. History is intentionally NOT sent: the
 * Hermes server keeps the conversation memory under `sessionId`.
 */
export async function sendHermesMessage(
  sessionId: string,
  content: string,
): Promise<string> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Hermes-Session-Id": sessionId,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/hermes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ messages: [{ role: "user", content }] }),
    });
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
  const reply = data.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || reply.trim().length === 0) {
    throw new HermesError("invalid_response", "hermes returned no message content");
  }
  return reply;
}
