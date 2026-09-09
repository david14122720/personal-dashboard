/**
 * API client: base URL, Bearer injection from localStorage, and
 * single-flight 401 handling (clear token once, redirect once).
 *
 * Money coercion lives in `lib/api/money.ts` — this module never parses
 * decimal strings itself; callers coerce at the boundary only.
 */

export const TOKEN_KEY = "dashboard-token";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "/api";
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private browsing / quota: session simply won't persist.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Single-flight guard: concurrent 401s trigger exactly one redirect. */
let redirectInFlight = false;

/**
 * Navigation seam for the login redirect. Defaults to a full-page
 * `location.assign` (correct for a static export with no server router);
 * callers may inject a client-side router navigation instead.
 */
let navigateToLogin: (url: string) => void = (url) => {
  if (typeof window !== "undefined") {
    window.location.assign(url);
  }
};

export function setLoginNavigator(fn: (url: string) => void): void {
  navigateToLogin = fn;
}

export function resetLoginNavigator(): void {
  navigateToLogin = (url) => {
    if (typeof window !== "undefined") {
      window.location.assign(url);
    }
  };
}

export function resetAuthRedirectForTests(): void {
  redirectInFlight = false;
  resetLoginNavigator();
}

function loginPath(): string {
  return "/login/";
}

export function handleUnauthorized(): void {
  if (redirectInFlight) return;
  redirectInFlight = true;
  clearToken();
  navigateToLogin(loginPath());
}

export interface LoginResponse {
  token: string;
  expires_at: string;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${apiBaseUrl()}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  const data = (await res.json()) as LoginResponse;
  setToken(data.token);
  return data;
}

export function logout(): void {
  const token = getToken();
  clearToken();
  if (token) {
    void fetch(`${apiBaseUrl()}/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {
      // Best-effort server revocation; local session is already cleared.
    });
  }
  if (typeof window !== "undefined") {
    window.location.assign(loginPath());
  }
}

export async function toApiError(res: Response): Promise<ApiError> {
  let code = "REQUEST_FAILED";
  let message = `Request failed with status ${res.status}`;
  try {
    const body = (await res.json()) as {
      code?: string;
      message?: string;
      error?: { code?: string; message?: string };
    };
    code = body.code ?? body.error?.code ?? code;
    message = body.message ?? body.error?.message ?? message;
  } catch {
    // Non-JSON error body: keep the status-derived defaults.
  }
  return new ApiError(res.status, code, message);
}

/**
 * Authenticated fetch. Attaches `Authorization: Bearer <token>` when a
 * token is stored; on 401 clears the token and single-flights to /login.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${apiBaseUrl()}${path}`, { ...init, headers });
  if (res.status === 401) {
    handleUnauthorized();
    throw new ApiError(401, "UNAUTHORIZED", "Session expired. Redirecting to login.");
  }
  return res;
}

export async function apiGet<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, { ...init, method: "GET" });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as T;
}

/**
 * Authenticated POST with a JSON body. Reuses `apiFetch` (Bearer injection
 * + single-flight 401) and `toApiError` for failures. Money travels as
 * decimal strings; this helper never coerces amounts.
 */
export async function apiPost<T>(path: string, body: unknown, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await apiFetch(path, { ...init, method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as T;
}

/**
 * Authenticated DELETE. Reuses `apiFetch` + `toApiError`. A 204 (no content)
 * resolves to void without parsing a body.
 */
export async function apiDelete(path: string, init: RequestInit = {}): Promise<void> {
  const res = await apiFetch(path, { ...init, method: "DELETE" });
  if (!res.ok) {
    throw await toApiError(res);
  }
}
