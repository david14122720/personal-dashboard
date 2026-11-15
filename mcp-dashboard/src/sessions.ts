/**
 * Bounded session registry for the Streamable HTTP transport.
 *
 * Audit F-02: the transport map had no cap, no TTL and no eviction, so an
 * unauthenticated `initialize` loop could retain ~43 KB per session until the
 * container was killed (which also took the API down, because one entrypoint
 * supervises both). This registry adds the three missing bounds and keeps the
 * clock injectable so the TTL is tested without sleeping.
 *
 * Each entry can also be bound to the validated identity that created it. A
 * lookup with a different owner is answered exactly like an unknown id: the
 * holder of a valid credential who learns another session's UUID must not be
 * able to consume or close that session, and must not learn that it exists.
 */
export interface ClosableSession {
  close(): void;
}

interface Entry<T> {
  value: T;
  lastSeen: number;
  /** `users.id` of the validated identity that opened this session. */
  owner?: string;
}

export class SessionRegistry<T extends ClosableSession> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /**
   * True when a live slot is free. Expired entries are closed first, so a
   * burst of idle sessions cannot keep the server at its cap while the
   * periodic sweep waits for its next tick.
   */
  canOpen(): boolean {
    this.reapExpired();
    return this.entries.size < this.max;
  }

  /** Store a new session. Returns false when the cap is already reached. */
  open(id: string, value: T, owner?: string): boolean {
    if (!this.canOpen()) return false;
    this.entries.set(id, { value, lastSeen: this.now(), owner });
    return true;
  }

  /**
   * Look a session up and refresh its idle timer. When an `owner` is given, a
   * session bound to anyone else is indistinguishable from an unknown id: the
   * caller gets `undefined` and the session is neither refreshed nor closed.
   */
  get(id: string, owner?: string): T | undefined {
    const entry = this.entries.get(id);
    if (entry === undefined) return undefined;
    if (this.isExpired(entry.lastSeen)) {
      this.close(id);
      return undefined;
    }
    if (owner !== undefined && entry.owner !== owner) return undefined;
    entry.lastSeen = this.now();
    return entry.value;
  }

  /** Refresh a session's idle timer without returning its value. */
  touch(id: string, owner?: string): void {
    const entry = this.entries.get(id);
    if (entry === undefined || this.isExpired(entry.lastSeen)) return;
    if (owner !== undefined && entry.owner !== owner) return;
    entry.lastSeen = this.now();
  }

  /**
   * Close a session. With an `owner`, only that identity's session is closed;
   * a mismatch is a no-op, exactly as if the id did not exist.
   */
  close(id: string, owner?: string): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    if (owner !== undefined && entry.owner !== owner) return;
    this.entries.delete(id);
    entry.value.close();
  }

  /** Close every session idle for longer than the TTL; returns their ids. */
  sweep(): string[] {
    return this.reapExpired();
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  /** Close and drop every expired entry; returns the ids it closed. */
  private reapExpired(): string[] {
    const closed: string[] = [];
    for (const [id, entry] of [...this.entries.entries()]) {
      if (this.isExpired(entry.lastSeen)) {
        this.entries.delete(id);
        entry.value.close();
        closed.push(id);
      }
    }
    return closed;
  }

  private isExpired(lastSeen: number): boolean {
    return this.now() - lastSeen > this.ttlMs;
  }
}
