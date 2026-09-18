/**
 * Personal API tokens (`pd_` Bearer credentials) over the shared client.
 *
 * The raw secret travels exactly once, inside the `POST /tokens` response.
 * Every other surface (list, revoke) only ever carries the display `prefix`
 * and metadata — callers must never expect secret material there.
 */

import { apiDelete, apiGet, apiPost } from "@/lib/api/client";

/** List/revoke shape: metadata only, never the raw secret nor its hash. */
export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: unknown;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** Create shape: the only response that carries the raw secret, once. */
export interface CreatedToken {
  id: string;
  name: string;
  /** Raw `pd_…` secret. Shown to the user once, then dropped. */
  token: string;
  prefix: string;
  expires_at: string | null;
}

export function listTokens(): Promise<ApiToken[]> {
  return apiGet<ApiToken[]>("/tokens");
}

export function createToken(name: string, expires_in_days?: number): Promise<CreatedToken> {
  const body: { name: string; expires_in_days?: number } = { name };
  // `deny_unknown_fields` server-side: omit the key instead of sending null.
  if (expires_in_days !== undefined) {
    body.expires_in_days = expires_in_days;
  }
  return apiPost<CreatedToken>("/tokens", body);
}

export function revokeToken(id: string): Promise<void> {
  return apiDelete(`/tokens/${id}`);
}
