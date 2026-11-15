// Typed fetch wrapper for the personal-dashboard Axum backend.
//
// Auth: POST /api/login { email, password } -> { token, expires_at }.
// Everything else uses `Authorization: Bearer <token>`.
//
// Token resolution is per-request: callers pass the token explicitly
// (taken from the incoming MCP request's `Authorization` header) and it is
// only used after `GET /api/me` validated it (audit F-09, in auth.ts). There
// is no environment fallback and no mutable process-global token state, so a
// request without a credential is never authenticated and concurrent MCP
// clients cannot leak credentials into each other (audit F-10).
//
// Env:
//   PERSONAL_DASHBOARD_API_URL default http://localhost:3001/api

const DEFAULT_API_URL = "http://localhost:3001/api";

/** Explicit per-request token. `undefined` means "send no credential". */
export type RequestToken = string | undefined;

export function getApiBaseUrl(): string {
  const raw = process.env.PERSONAL_DASHBOARD_API_URL?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_API_URL;
  return base.replace(/\/+$/, "");
}

/**
 * The explicit per-request token, or nothing. There is deliberately no
 * environment fallback: an absent header must never authenticate (audit F-10).
 */
export function resolveToken(explicit: RequestToken): string | undefined {
  const t = explicit?.trim();
  return t && t.length > 0 ? t : undefined;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`personal-dashboard API ${status}: ${body}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type FetchInit = {
  method: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  auth?: boolean;
  token?: RequestToken;
};

export function buildPath(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    params.append(k, String(v));
  }
  const qs = params.toString();
  return qs.length > 0 ? `${path}?${qs}` : path;
}

export async function apiFetch<T>(path: string, init: FetchInit): Promise<T> {
  const url = `${getApiBaseUrl()}${buildPath(path, init.query)}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (init.auth !== false) {
    const token = resolveToken(init.token);
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(url, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(res.status, text.length > 0 ? text : res.statusText);
  }
  if (text.length === 0 || res.status === 204) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export function apiGet<T>(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
  token?: RequestToken,
): Promise<T> {
  return apiFetch<T>(path, { method: "GET", query, token });
}

export function apiPost<T>(path: string, body?: unknown, token?: RequestToken): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: body ?? {}, token });
}

export function apiPatch<T>(path: string, body: unknown, token?: RequestToken): Promise<T> {
  return apiFetch<T>(path, { method: "PATCH", body, token });
}

export function apiDelete<T>(path: string, token?: RequestToken): Promise<T> {
  return apiFetch<T>(path, { method: "DELETE", token });
}
