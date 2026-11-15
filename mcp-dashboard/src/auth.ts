// Server-side credential validation for the MCP HTTP surface (audit F-09 / S1).
//
// A presented Bearer token is only a credential once the backend accepts it.
// Presence alone never authenticates, so every /mcp request is checked with
// `GET /api/me` before a session is allocated or a `tools/call` is dispatched.
// Definitive verdicts are cached per token hash for at most 60 seconds in a
// bounded map, so a live session's tool calls do not become one API round-trip
// each. Undetermined outcomes (transport failure, timeout, 5xx/429) are never
// cached: a 10-second backend restart must not answer 401 for valid tokens
// until the TTL expires, so the next call retries.
//
// The validator is injectable (McpApp options) so tests never need a backend.

import { createHash } from "node:crypto";
import { ApiError, apiGet } from "./client.js";

/** Who the backend said the presented credential belongs to. */
export interface CallerIdentity {
  /** `users.id` as returned by `GET /api/me`. */
  userId: string;
  email?: string;
}

/**
 * Resolves a presented credential. `undefined` means the backend definitively
 * rejected it (401/403) and may be cached; a throw means the result is
 * undetermined (transport failure, timeout, 5xx/429) and is never cached.
 */
export type TokenValidator = (token: string) => Promise<CallerIdentity | undefined>;

/**
 * True only when the backend itself refused the credential. Client errors
 * such as 400/404 say nothing about the token, and neither does a 5xx or a
 * transport exception: those leave the verdict undetermined.
 */
export function isDefinitiveRejection(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

interface MePayload {
  id?: unknown;
  email?: unknown;
}

/**
 * Real validator: `GET /api/me` with the presented token. Only a 200 with a
 * non-empty `id` counts.
 *
 * A 401/403 is a definitive rejection and is returned as `undefined`. Every
 * other outcome — network error, timeout, 5xx, 429 — says nothing about the
 * credential, so it is re-thrown for the cache to leave undetermined instead
 * of pinning a valid token as invalid. A malformed 200 is also undetermined:
 * the backend broke its own contract, which is not proof the token is bad.
 */
export function createApiValidator(): TokenValidator {
  return async (token: string) => {
    let me: MePayload;
    try {
      me = await apiGet<MePayload>("/me", undefined, token);
    } catch (err) {
      if (isDefinitiveRejection(err)) return undefined;
      throw err;
    }
    if (typeof me?.id !== "string" || me.id.length === 0) {
      throw new Error("GET /api/me returned no identity");
    }
    return {
      userId: me.id,
      email: typeof me.email === "string" ? me.email : undefined,
    };
  };
}

/** Hard ceiling on how long a validation verdict is trusted (spec S1: ≤60 s). */
export const MAX_VALIDATION_TTL_MS = 60_000;

const DEFAULT_VALIDATION_TTL_MS = 15_000;
const DEFAULT_MAX_ENTRIES = 128;

export interface ValidationCacheOptions {
  /** How long a verdict is reused. Clamped to `MAX_VALIDATION_TTL_MS`. */
  ttlMs?: number;
  /** Upper bound on cached verdicts (FIFO eviction beyond it). */
  maxEntries?: number;
  /** Injectable clock so the TTL is testable without sleeping. */
  now?: () => number;
}

interface Verdict {
  identity: CallerIdentity | undefined;
  expiresAt: number;
}

/**
 * Bounded TTL cache of credential verdicts, keyed by SHA-256 of the token so
 * the raw credential never lives in the cache. Concurrent checks of the same
 * token share one in-flight validation. Only definitive verdicts are cached —
 * acceptances and the backend's own 401/403 rejections (both for the same
 * short window) — so a hostile client cannot turn the cache into an API
 * amplifier while a transient backend failure stays retryable.
 */
export class TokenValidationCache {
  private readonly verdicts = new Map<string, Verdict>();
  private readonly pending = new Map<string, Promise<CallerIdentity | undefined>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(
    private readonly validate: TokenValidator,
    options: ValidationCacheOptions = {},
  ) {
    const ttl = options.ttlMs ?? DEFAULT_VALIDATION_TTL_MS;
    this.ttlMs = Math.max(0, Math.min(ttl, MAX_VALIDATION_TTL_MS));
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_MAX_ENTRIES));
    this.now = options.now ?? (() => Date.now());
  }

  /** Number of cached verdicts (bounded by `maxEntries`). */
  get size(): number {
    return this.verdicts.size;
  }

  /** Validate a credential, reusing a recent verdict when there is one. */
  async check(rawToken: string): Promise<CallerIdentity | undefined> {
    const token = rawToken.trim();
    if (token.length === 0) return undefined;
    const key = createHash("sha256").update(token).digest("hex");

    const cached = this.verdicts.get(key);
    if (cached !== undefined) {
      if (cached.expiresAt > this.now()) return cached.identity;
      this.verdicts.delete(key);
    }

    const inFlight = this.pending.get(key);
    if (inFlight !== undefined) return inFlight;

    const settled = this.validate(token)
      // A throw is an undetermined result (transport error, timeout, 5xx, 429)
      // unless the backend itself denied the credential. Undetermined stays
      // uncached so the next call retries instead of serving a stale 401.
      .then((identity) => ({ definite: true, identity }))
      .catch((err: unknown) => ({
        definite: isDefinitiveRejection(err),
        identity: undefined,
      }))
      .then((verdict) => {
        if (verdict.definite) this.remember(key, verdict.identity);
        this.pending.delete(key);
        return verdict.identity;
      });
    this.pending.set(key, settled);
    return settled;
  }

  private remember(key: string, identity: CallerIdentity | undefined): void {
    if (this.verdicts.size >= this.maxEntries) {
      // Map iterates in insertion order, so the first key is the oldest.
      const oldest = this.verdicts.keys().next();
      if (!oldest.done) this.verdicts.delete(oldest.value);
    }
    this.verdicts.set(key, { identity, expiresAt: this.now() + this.ttlMs });
  }
}
