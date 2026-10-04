/**
 * Session management (`GET /api/sessions`, `DELETE /api/sessions`) over the
 * shared client.
 *
 * The backend never returns `token_hash`; every row is metadata only and
 * `current` marks the session presenting the request. Revoking closes every
 * other session of the caller and never the presenting one.
 */

import { apiDelete, apiGet } from "@/lib/api/client";

export interface SessionInfo {
  id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  user_agent: string | null;
  ip_address: string | null;
  /** True only for the session presenting the request. */
  current: boolean;
}

export function listSessions(): Promise<SessionInfo[]> {
  return apiGet<SessionInfo[]>("/sessions");
}

export function revokeOtherSessions(): Promise<void> {
  return apiDelete("/sessions");
}
