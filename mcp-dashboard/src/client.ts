// Typed fetch wrapper for the personal-dashboard Axum backend.
//
// Auth: POST /api/login { email, password } -> { token, expires_at }.
// Everything else uses `Authorization: Bearer <token>`.
//
// Token resolution is per-request: callers pass the token explicitly
// (taken from the incoming MCP request's `Authorization` header).
// Fallback is the PERSONAL_DASHBOARD_TOKEN env var. There is no mutable
// process-global token state, so concurrent MCP clients cannot leak
// credentials into each other.
//
// Env:
//   PERSONAL_DASHBOARD_API_URL default http://localhost:3001/api
//   PERSONAL_DASHBOARD_TOKEN   optional fallback token (e.g. pd_... api token)

const DEFAULT_API_URL = "http://localhost:3001/api";

/** Explicit per-request token. `undefined` means "try the env fallback". */
export type RequestToken = string | undefined;

export function getApiBaseUrl(): string {
  const raw = process.env.PERSONAL_DASHBOARD_API_URL?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_API_URL;
  return base.replace(/\/+$/, "");
}

/** Env-only fallback token (PERSONAL_DASHBOARD_TOKEN). */
export function getEnvToken(): string | undefined {
  const env = process.env.PERSONAL_DASHBOARD_TOKEN?.trim();
  return env && env.length > 0 ? env : undefined;
}

/** Explicit per-request token wins; otherwise the env fallback. */
export function resolveToken(explicit: RequestToken): string | undefined {
  const t = explicit?.trim();
  if (t && t.length > 0) return t;
  return getEnvToken();
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

export interface LoginResponse {
  token: string;
  expires_at: string;
}

/**
 * POST /api/login. Returns the token to the caller; it is NOT cached
 * anywhere global. The caller must send it back as
 * `Authorization: Bearer <token>` on subsequent MCP requests.
 */
export async function login(email: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/login", {
    method: "POST",
    body: { email, password },
    auth: false,
  });
}
