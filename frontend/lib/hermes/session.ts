/**
 * Hermes conversation identity.
 *
 * The browser owns only a UUID v4. Conversation memory lives on the Hermes
 * server, so the id is the entire client-side state that must survive reloads.
 * Every storage access is guarded: private browsing must not break the chat.
 */

export const HERMES_SESSION_KEY = "hermes_session_id";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidSessionId(value: string): boolean {
  return UUID_V4.test(value);
}

/**
 * `crypto.randomUUID` is only available in secure contexts; the dashboard can
 * be served over plain HTTP on the LAN, so fall back to `getRandomValues`
 * while keeping the v4 version/variant bits correct.
 */
export function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function saveSessionId(id: string): void {
  try {
    localStorage.setItem(HERMES_SESSION_KEY, id);
  } catch {
    // Storage disabled: the in-memory id still drives this conversation.
  }
}

/** Recover a valid stored id or mint and persist a fresh one. */
export function loadOrCreateSessionId(): string {
  try {
    const stored = localStorage.getItem(HERMES_SESSION_KEY);
    if (stored && isValidSessionId(stored)) return stored;
  } catch {
    // Fall through to a fresh id.
  }
  const id = newSessionId();
  saveSessionId(id);
  return id;
}
