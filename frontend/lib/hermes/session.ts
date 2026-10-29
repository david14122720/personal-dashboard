/**
 * Hermes conversation identity.
 *
 * The browser owns only a UUID v4. Conversation memory lives on the Hermes
 * server, so the id is the entire client-side state that must survive reloads.
 * Every storage access is guarded: private browsing must not break the chat.
 */

export const HERMES_SESSION_KEY = "hermes_session_id";
/** In-flight run, so a refresh can re-subscribe instead of losing the turn. */
export const HERMES_RUN_KEY = "pd-hermes-run";

export interface HermesActiveRun {
  sessionId: string;
  runId: string;
  startedAt: number;
}

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

export function saveActiveRun(run: HermesActiveRun): void {
  try {
    localStorage.setItem(HERMES_RUN_KEY, JSON.stringify(run));
  } catch {
    // Storage disabled: the run still streams, it just cannot survive a refresh.
  }
}

/** The in-flight run left behind by a refresh, if it parses. */
export function loadActiveRun(): HermesActiveRun | null {
  try {
    const raw = localStorage.getItem(HERMES_RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HermesActiveRun>;
    if (
      typeof parsed.sessionId !== "string" ||
      typeof parsed.runId !== "string" ||
      parsed.runId.length === 0 ||
      typeof parsed.startedAt !== "number"
    ) {
      return null;
    }
    return { sessionId: parsed.sessionId, runId: parsed.runId, startedAt: parsed.startedAt };
  } catch {
    return null;
  }
}

export function clearActiveRun(): void {
  try {
    localStorage.removeItem(HERMES_RUN_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Settled transcript, so a refresh shows the same conversation (S5). */
export const HERMES_MESSAGES_KEY = "pd-hermes-messages";
/** Never store more bubbles than the UI can cheaply restore. */
export const HERMES_MAX_STORED_BUBBLES = 40;
/** …nor more bytes than a single localStorage entry should hold. */
export const HERMES_MAX_STORED_BYTES = 200 * 1024;

export interface StoredAttachment {
  name: string;
  size: number;
  kind: string;
}

export interface StoredToolEvent {
  tool: string;
  label?: string;
  emoji?: string;
  status?: string;
  toolCallId?: string;
}

export interface StoredThought {
  kind: "thinking" | "tool";
  text?: string;
  tool?: StoredToolEvent;
}

export interface StoredArtifact {
  id: string;
  name: string;
  url: string;
  mime?: string;
  size?: number;
  kind: string;
  path?: string;
}

export interface StoredQuestionOption {
  title: string;
  description?: string;
  value: string;
}

export interface StoredQuestion {
  prompt: string;
  options: StoredQuestionOption[];
}

/** Serializable settled bubbles: user + assistant + error, never live content. */
export type StoredBubble =
  | {
      id: number;
      role: "user";
      content: string;
      attachments: StoredAttachment[];
      queued: boolean;
    }
  | {
      id: number;
      role: "assistant";
      content: string;
      artifacts: StoredArtifact[];
      warnings: string[];
      thoughts: StoredThought[];
      question: StoredQuestion | null;
      answered: string | null;
    }
  | {
      id: number;
      role: "error";
      code: string;
      message: string | null;
      retryContent: string;
      retryIds: string[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStoredAttachment(value: unknown): value is StoredAttachment {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.size === "number" &&
    typeof value.kind === "string"
  );
}

function isStoredToolEvent(value: unknown): value is StoredToolEvent {
  return (
    isRecord(value) &&
    typeof value.tool === "string" &&
    (value.label === undefined || typeof value.label === "string") &&
    (value.emoji === undefined || typeof value.emoji === "string") &&
    (value.status === undefined || typeof value.status === "string") &&
    (value.toolCallId === undefined || typeof value.toolCallId === "string")
  );
}

function isStoredThought(value: unknown): value is StoredThought {
  return (
    isRecord(value) &&
    (value.kind === "thinking" || value.kind === "tool") &&
    (value.text === undefined || typeof value.text === "string") &&
    (value.tool === undefined || isStoredToolEvent(value.tool))
  );
}

function isStoredArtifact(value: unknown): value is StoredArtifact {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.url === "string"
  );
}

function isStoredQuestion(value: unknown): value is StoredQuestion {
  if (!isRecord(value) || typeof value.prompt !== "string" || !Array.isArray(value.options)) {
    return false;
  }
  return value.options.every(
    (option) =>
      isRecord(option) && typeof option.title === "string" && typeof option.value === "string",
  );
}

/** A bubble that fails validation is dropped; nested junk is tolerable. */
function cleanStoredBubble(value: unknown): StoredBubble | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "number" || !Number.isFinite(value.id)) return null;
  switch (value.role) {
    case "user": {
      if (typeof value.content !== "string") return null;
      if (!Array.isArray(value.attachments) || !value.attachments.every(isStoredAttachment)) {
        return null;
      }
      if (typeof value.queued !== "boolean") return null;
      return {
        id: value.id,
        role: "user",
        content: value.content,
        attachments: value.attachments as StoredAttachment[],
        queued: value.queued,
      };
    }
    case "assistant": {
      if (typeof value.content !== "string") return null;
      if (!Array.isArray(value.artifacts) || !value.artifacts.every(isStoredArtifact)) {
        return null;
      }
      if (!Array.isArray(value.warnings) || !value.warnings.every((w) => typeof w === "string")) {
        return null;
      }
      if (!Array.isArray(value.thoughts) || !value.thoughts.every(isStoredThought)) {
        return null;
      }
      // A broken question must not sink the bubble: the prose still reads.
      const question = value.question === null || value.question === undefined ? null : value.question;
      if (question !== null && !isStoredQuestion(question)) return null;
      if (value.answered !== null && value.answered !== undefined && typeof value.answered !== "string") {
        return null;
      }
      return {
        id: value.id,
        role: "assistant",
        content: value.content,
        artifacts: value.artifacts as StoredArtifact[],
        warnings: value.warnings as string[],
        thoughts: value.thoughts as StoredThought[],
        question: question as StoredQuestion | null,
        answered: typeof value.answered === "string" ? value.answered : null,
      };
    }
    case "error": {
      if (typeof value.code !== "string") return null;
      if (value.message !== null && value.message !== undefined && typeof value.message !== "string") {
        return null;
      }
      if (typeof value.retryContent !== "string") return null;
      if (!Array.isArray(value.retryIds) || !value.retryIds.every((id) => typeof id === "string")) {
        return null;
      }
      return {
        id: value.id,
        role: "error",
        code: value.code,
        message: typeof value.message === "string" ? value.message : null,
        retryContent: value.retryContent,
        retryIds: value.retryIds as string[],
      };
    }
    default:
      return null;
  }
}

function storedBytes(json: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(json).length;
  return json.length;
}

/** Persist settled bubbles only; drops the oldest until both caps hold. */
export function saveMessages(bubbles: readonly StoredBubble[]): void {
  try {
    let kept = bubbles.slice(-HERMES_MAX_STORED_BUBBLES);
    let json = JSON.stringify(kept);
    while (kept.length > 0 && storedBytes(json) > HERMES_MAX_STORED_BYTES) {
      kept = kept.slice(1);
      json = JSON.stringify(kept);
    }
    localStorage.setItem(HERMES_MESSAGES_KEY, json);
  } catch {
    // Private browsing or quota: the transcript just won't survive a refresh.
  }
}

export function clearMessages(): void {
  try {
    localStorage.removeItem(HERMES_MESSAGES_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** The stored transcript: invalid entries are dropped, garbage yields []. */
export function loadMessages(): StoredBubble[] {
  try {
    const raw = localStorage.getItem(HERMES_MESSAGES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: StoredBubble[] = [];
    for (const item of parsed) {
      const clean = cleanStoredBubble(item);
      if (clean) out.push(clean);
    }
    return out;
  } catch {
    return [];
  }
}
