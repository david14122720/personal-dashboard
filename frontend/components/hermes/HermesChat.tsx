"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ApprovalRequestCard, {
  type ApprovalDecision,
} from "@/components/hermes/ApprovalRequestCard";
import AttachmentBar, { KindIcon } from "@/components/hermes/AttachmentBar";
import HermesMessageBody from "@/components/hermes/HermesMessageBody";
import InteractiveQuestionCard from "@/components/hermes/InteractiveQuestionCard";
import MicButton from "@/components/hermes/MicButton";
import ThoughtAccordion, { type ThoughtEntry } from "@/components/hermes/ThoughtAccordion";
import {
  HermesError,
  createHermesRun,
  fetchHermesUpload,
  getHermesRun,
  isHermesRunActive,
  resolveHermesApproval,
  streamHermesRun,
  uploadHermesFile,
  type HermesErrorCode,
  type HermesRunEvent,
  type HermesToolEvent,
  type HermesUploadedFile,
} from "@/lib/api/hermes";
import { formatElapsed } from "@/lib/hermes/elapsed";
import { splitQuestion, type HermesQuestion } from "@/lib/hermes/questions";
import {
  classifyFile,
  composeTurnText,
  formatBytes,
  planAttachments,
  releaseAttachment,
  travelsInline,
  type AttachmentKind,
  type AttachmentRejection,
  type AttachmentUploadStatus,
  type PendingAttachment,
} from "@/lib/hermes/attachments";
import {
  clearActiveRun,
  clearMessages,
  loadActiveRun,
  loadMessages,
  loadOrCreateSessionId,
  newSessionId,
  saveActiveRun,
  saveMessages,
  saveSessionId,
  type StoredBubble,
} from "@/lib/hermes/session";
import { t } from "@/lib/i18n";

interface SentAttachment {
  /** Runtime key of the pending chip; never persisted. */
  key: string;
  name: string;
  size: number;
  kind: AttachmentKind;
  /** Blob URL captured at send time; only valid while the chip lives. */
  previewUrl?: string | null;
  /** What `POST /api/uploads` answered (S4); the reload-safe source. */
  url?: string;
  mime_type?: string;
  local_path?: string;
}

/**
 * Absolute blob URL for one stored attachment, memoized per url and revoked
 * when the bubble unmounts or the url changes.
 *
 * Declared deviation D-B2: `GET /api/uploads/{id}` is session-authenticated
 * and an `<img>`/`<video>`/`<audio>` element cannot send the bearer, so the
 * bytes are read once through the authenticated transport and handed to the
 * element as an object URL. That is also why nothing here ever points the
 * element at a model-authored address: the source is always a receipt URL.
 */
type StoredMediaStatus = "idle" | "loading" | "ready" | "failed";

function useStoredMediaUrl(url: string | undefined): {
  src: string | null;
  status: StoredMediaStatus;
} {
  const [state, setState] = useState<{ src: string | null; status: StoredMediaStatus }>({
    src: null,
    status: url ? "loading" : "idle",
  });

  useEffect(() => {
    if (!url) {
      setState({ src: null, status: "idle" });
      return;
    }
    let cancelled = false;
    let owned: string | null = null;
    setState({ src: null, status: "loading" });
    void fetchHermesUpload(url).then(
      (blob) => {
        if (cancelled) return;
        owned = URL.createObjectURL(blob);
        setState({ src: owned, status: "ready" });
      },
      () => {
        // An unreadable attachment falls back to its card in the caller.
        if (!cancelled) setState({ src: null, status: "failed" });
      },
    );
    return () => {
      cancelled = true;
      if (owned && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(owned);
      }
    };
  }, [url]);

  return state;
}

/**
 * One sent attachment inside a user bubble (S5).
 *
 * Images, video and audio draw their real element from a blob URL; a document
 * — and any media whose bytes cannot be read (401/404) — degrades to the card
 * with name, weight and family icon, so a failed read never breaks the bubble.
 */
const UserAttachment = memo(function UserAttachment({
  attachment,
}: {
  attachment: SentAttachment;
}) {
  // JD-B-005: while the local preview is alive the bytes are already in memory,
  // so reading them back would download a 100 MB video a second time.
  const stored = useStoredMediaUrl(
    attachment.kind === "document" || attachment.previewUrl ? undefined : attachment.url,
  );
  // A stored url is the only reload-safe source; the chip's blob URL covers
  // the frame before the upload receipt lands and never outlives the chip. A
  // failed read (401/404) drops straight to the card.
  const src =
    stored.status === "failed"
      ? null
      : (stored.src ?? attachment.previewUrl ?? null);

  if (src && attachment.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={attachment.name}
        loading="lazy"
        className="max-h-48 max-w-full rounded-lg border border-hair object-contain"
      />
    );
  }
  if (src && attachment.kind === "video") {
    return (
      <video
        controls
        src={src}
        aria-label={attachment.name}
        className="max-h-56 max-w-full rounded-lg border border-hair"
      />
    );
  }
  if (src && attachment.kind === "audio") {
    return <audio controls src={src} aria-label={attachment.name} className="w-full min-w-[12rem]" />;
  }
  return (
    <span
      data-testid="user-attachment-card"
      className="flex min-w-0 max-w-full items-center gap-2 rounded-md bg-deck/60 px-2 py-1 text-[11px] text-slate-200"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-sky-500/10">
        <KindIcon kind={attachment.kind} />
      </span>
      <span className="min-w-0">
        <span className="block max-w-[12rem] truncate" title={attachment.name}>
          {attachment.name}
        </span>
        <span className="block text-[10px] text-muted">{formatBytes(attachment.size)}</span>
      </span>
    </span>
  );
});

/** A security gate the run is parked on, copied off the `approval.request`. */
interface ApprovalRequest {
  promptId: string;
  executionGeneration: number;
  tool: string;
  command: string;
  description: string | null;
  decision: ApprovalDecision;
  error: string | null;
}

type Bubble =
  | {
      id: number;
      role: "user";
      content: string;
      attachments: SentAttachment[];
      queued: boolean;
    }
  | {
      id: number;
      role: "assistant";
      content: string;
      warnings: string[];
      thoughts: ThoughtEntry[];
      question: HermesQuestion | null;
      answered: string | null;
    }
  | {
      id: number;
      role: "error";
      code: HermesErrorCode;
      message: string | null;
      retryContent: string;
      retryFiles: File[];
      retryIds: string[];
    };

interface QueuedTurn {
  /** The waiting user bubble, if one was drawn; retries reuse the original. */
  bubbleId: number | null;
  content: string;
  files: File[];
  ids: string[];
}

let nextBubbleId = 1;
function bubbleId(): number {
  const id = nextBubbleId;
  nextBubbleId += 1;
  return id;
}

/** Restored ids must not collide with future bubbles in this session. */
function reserveBubbleIds(stored: readonly StoredBubble[]) {
  for (const bubble of stored) {
    if (bubble.id >= nextBubbleId) nextBubbleId = bubble.id + 1;
  }
}

/**
 * Settled bubbles only: live/streaming content never reaches storage, File
 * objects cannot survive a refresh (retry re-sends text-only), and queued
 * flags are runtime state, so a restored transcript never auto-sends.
 */
function toStoredBubble(bubble: Bubble): StoredBubble {
  switch (bubble.role) {
    case "user":
      return {
        id: bubble.id,
        role: "user",
        content: bubble.content,
        // The runtime key and the chip's blob URL never reach storage: the
        // next load must repaint from the upload receipt alone (S5).
        attachments: bubble.attachments.map((item) => ({
          name: item.name,
          size: item.size,
          kind: item.kind,
          ...(item.url ? { url: item.url } : {}),
          ...(item.mime_type ? { mime_type: item.mime_type } : {}),
          ...(item.local_path ? { local_path: item.local_path } : {}),
        })),
        queued: false,
      };
    case "assistant":
      return {
        id: bubble.id,
        role: "assistant",
        content: bubble.content,
        warnings: [...bubble.warnings],
        thoughts: bubble.thoughts.map((entry) => ({ ...entry })),
        question: bubble.question ? { ...bubble.question } : null,
        answered: bubble.answered,
      };
    case "error":
      return {
        id: bubble.id,
        role: "error",
        code: bubble.code,
        message: bubble.message,
        retryContent: bubble.retryContent,
        retryIds: [...bubble.retryIds],
      };
  }
}

function fromStoredBubble(stored: StoredBubble): Bubble {
  switch (stored.role) {
    case "user":
      return {
        id: stored.id,
        role: "user",
        content: stored.content,
        attachments: stored.attachments.map((item) => ({
          key: "",
          name: item.name,
          size: item.size,
          kind: item.kind as AttachmentKind,
          previewUrl: null,
          url: item.url,
          mime_type: item.mime_type,
          local_path: item.local_path,
        })),
        queued: false,
      };
    case "assistant":
      return {
        id: stored.id,
        role: "assistant",
        content: stored.content,
        warnings: [...stored.warnings],
        thoughts: stored.thoughts.map(
          (entry): ThoughtEntry => ({
            kind: entry.kind,
            text: entry.text,
            tool: entry.tool ? { ...entry.tool } : undefined,
          }),
        ),
        question: stored.question ? { ...stored.question } : null,
        answered: stored.answered,
      };
    case "error":
      return {
        id: stored.id,
        role: "error",
        code: stored.code as HermesErrorCode,
        message: stored.message,
        retryContent: stored.retryContent,
        retryFiles: [],
        retryIds: [...stored.retryIds],
      };
  }
}

function errorKey(code: HermesErrorCode) {
  switch (code) {
    case "timeout":
      return "hermes.errorTimeout" as const;
    case "unauthorized":
      return "hermes.errorUnauthorized" as const;
    case "session_expired":
      return "hermes.errorSessionExpired" as const;
    case "too_long":
      return "hermes.errorTooLong" as const;
    case "too_large":
      return "hermes.errorTooLarge" as const;
    case "too_many_attachments":
      return "hermes.errorTooManyAttachmentsServer" as const;
    case "unavailable":
      return "hermes.errorUnavailable" as const;
    case "network":
      return "hermes.errorNetwork" as const;
    case "invalid_response":
      return "hermes.errorInvalid" as const;
    default:
      return "hermes.errorUpstream" as const;
  }
}

const REJECTION_KEY = "hermes.errorTooManyAttachments" as const;

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Upstream failure prose, when the terminal event carries one. */
function terminalMessage(payload: HermesRunEvent): string | null {
  return (
    textOf(payload.error) ?? textOf(payload.message) ?? textOf(payload.turn_exit_reason)
  );
}

/**
 * A dead subscription is not a dead run (JD-B-001): the gateway keeps
 * executing, so the client retries the SSE subscribe with bounded backoff
 * before surfacing an error. Two attempts, ~1 s then ~3 s.
 */
const STREAM_RETRY_DELAYS_MS = [1_000, 3_000];

function hasPendingControls(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Only transient transport failures are worth the 1 s + 3 s retry budget
 * (HIGH-1): `network` (incl. a dropped SSE connection), `unavailable`
 * (502/503) and `timeout` (504). Any other `HermesError` code — 401/404,
 * validation, payload limits, upstream prose — is surfaced immediately so a
 * 4xx never burns the retry budget.
 */
function isTransientStreamCode(code: HermesErrorCode): boolean {
  return code === "network" || code === "unavailable" || code === "timeout";
}

/**
 * Safety net when a run parks on a gate the client cannot render
 * (MEDIUM-2): the run stays guarded and the pointer is kept so a reload can
 * retry the mapping. Hardcoded Spanish on purpose: i18n is out of scope and
 * an unmappable gate must never look like a normal running run.
 */
const UNMAPPABLE_APPROVAL_NOTICE =
  "Hermes est\u00e1 esperando un permiso que no se pudo mostrar. Dej\u00e1 la conversaci\u00f3n abierta o recarg\u00e1 la p\u00e1gina para reintentar la aprobaci\u00f3n.";

/**
 * Visible exhaustion status (HIGH-1): the stream is gone but the run guard
 * is still held, so the user sees this instead of a frozen chat. Hardcoded
 * Spanish on purpose (i18n is out of scope for this fix).
 */
/** A single upload that never settles must not hold the turn hostage. */
const UPLOAD_TIMEOUT_MS = 120_000;

const STREAM_LOST_STATUS =
  "Se perdi\u00f3 el stream, reconectando\u2026 Pod\u00e9s reintentar el mensaje o empezar una nueva conversaci\u00f3n.";

/**
 * Tailwind `max-h-40` in pixels: S3's auto-growing composer grows with its
 * content up to ten rems and then scrolls.
 */
const COMPOSER_MAX_HEIGHT = 160;

/**
 * Single mapper for both approval paths so they cannot drift (MEDIUM-2 +
 * measured gateway 0.22.5 contract): the live `approval.request` event and
 * `pending_controls[0]` share the exact shape `{kind, prompt_id,
 * execution_generation, command, description, choices}`. Primary keys are
 * `prompt_id` / `execution_generation` / `command`; `promptId` /
 * `request_id` / `requestId` and `preview` / `parameters` (stringified when
 * it is an object) are defensive fallbacks only. `tool` defaults to
 * `"terminal"` like the live path always did.
 *
 * Gate guard: when `kind` is present it must be `"approval"`; when
 * `choices` is present it must be a non-empty array (the real payload always
 * carries both). Entries carrying neither are still accepted through the
 * fallback aliases; entries with neither identity nor payload map to null.
 * Returns null when the gate cannot be identified or displayed.
 */
function approvalFromGate(
  raw: unknown,
  fallbackGeneration: number,
): ApprovalRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const control = raw as Record<string, unknown>;
  if ("kind" in control && control.kind !== undefined && control.kind !== "approval") {
    return null;
  }
  if ("choices" in control && control.choices !== undefined) {
    if (!Array.isArray(control.choices) || control.choices.length === 0) return null;
  }
  const promptId =
    textOf(control.prompt_id) ??
    textOf(control.promptId) ??
    textOf(control.request_id) ??
    textOf(control.requestId);
  let command = textOf(control.command) ?? textOf(control.preview);
  if (!command) {
    const params = control.parameters;
    if (typeof params === "string" && params.length > 0) {
      command = params;
    } else if (params && typeof params === "object") {
      try {
        const serialized = JSON.stringify(params);
        command = serialized.length > 0 ? serialized : null;
      } catch {
        command = null;
      }
    }
  }
  if (!promptId || !command) return null;
  const generationRaw = control.execution_generation ?? control.executionGeneration;
  const generation =
    typeof generationRaw === "number" ? generationRaw : fallbackGeneration;
  return {
    promptId,
    executionGeneration: generation,
    tool: textOf(control.tool) ?? "terminal",
    command,
    description: textOf(control.description),
    decision: "idle",
    error: null,
  };
}

/** One thinking entry, extended in place while reasoning keeps arriving. */
function appendThought(entries: ThoughtEntry[], text: string): ThoughtEntry[] {
  const last = entries[entries.length - 1];
  if (last && last.kind === "thinking") {
    return [...entries.slice(0, -1), { kind: "thinking", text: (last.text ?? "") + text }];
  }
  return [...entries, { kind: "thinking", text }];
}

/** Tool frames repeat the same `toolCallId`; the latest status wins. */
function upsertTool(entries: ThoughtEntry[], tool: HermesToolEvent): ThoughtEntry[] {
  const index = entries.findIndex(
    (entry) => entry.kind === "tool" && entry.tool?.toolCallId && entry.tool.toolCallId === tool.toolCallId,
  );
  if (index < 0) return [...entries, { kind: "tool", tool }];
  const merged = [...entries];
  // A completion frame may only carry `status`: keep the label captured
  // while the tool was running.
  const previous = merged[index].tool ?? { tool: tool.tool };
  merged[index] = { kind: "tool", tool: { ...previous, ...tool } };
  return merged;
}

export default function HermesChat() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  /** Per-chip upload state for the turn in flight (S3/D-B4). */
  const [uploadStatus, setUploadStatus] = useState<
    Record<string, AttachmentUploadStatus>
  >({});
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // `live` spans the whole run (create → terminal): the clock, the streamed
  // content and the pending approval all live here. `streamLost` marks the
  // HIGH-1 exhaustion state: the SSE subscription died after the bounded
  // retries (or failed with a non-retriable status) while the run guard is
  // still held. While `streamLost` is true the chat keeps a visible status
  // instead of a frozen dead end, and `live` is never null while
  // `activeRunRef` is set.
  const [live, setLive] = useState<{
    content: string;
    thoughts: ThoughtEntry[];
    startedAt: number;
    approval: ApprovalRequest | null;
    streamLost: boolean;
    approvalUnmappable: boolean;
  } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * Monotonic subscription generation (HIGH-1 follow-up): every `attachStream`
   * call takes the next value and each delivery point (`onEvent`,
   * `onTerminal`, the failure `.catch`, the pending retry timer) only acts
   * when its captured generation is still current. A same-run re-attach
   * (manual `retry()` after exhaustion) therefore cannot be settled, fed, or
   * failed by late callbacks from the superseded subscription, which still
   * pass the `runId` check. A plain `AbortSignal` identity is not enough:
   * an abort only marks cancellation, while the counter also invalidates
   * callbacks already queued in the microtask queue and pending retry
   * timers, uniformly, without coupling the guard to signal lifetimes.
   */
  const streamGenRef = useRef(0);
  const activeRunRef = useRef<{ runId: string; startedAt: number } | null>(null);
  const lastTurnRef = useRef<{ content: string; files: File[]; ids: string[] }>({
    content: "",
    files: [],
    ids: [],
  });
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  function syncStarting(value: boolean) {
    startingRef.current = value;
    setStarting(value);
  }
  const queueRef = useRef<QueuedTurn[]>([]);
  const thoughtsRef = useRef<ThoughtEntry[]>([]);
  const contentRef = useRef("");
  const pendingDeltaRef = useRef("");
  const flushTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const sessionRef = useRef<string | null>(null);
  sessionRef.current = sessionId;
  const hydratedRef = useRef(false);
  const messagesRef = useRef<Bubble[]>([]);
  messagesRef.current = messages;
  const logRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const firstScroll = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  attachmentsRef.current = attachments;

  // Recover or mint the UUID after mount: the static export prerenders this
  // page, and localStorage does not exist on the server. The settled
  // transcript is restored first so a refresh shows the same conversation;
  // a stored in-flight run is then re-subscribed, so Hermes' work survives.
  useEffect(() => {
    const id = loadOrCreateSessionId();
    setSessionId(id);
    const transcript = loadMessages();
    reserveBubbleIds(transcript);
    hydratedRef.current = true;
    if (transcript.length > 0) setMessages(transcript.map(fromStoredBubble));
    const stored = loadActiveRun();
    if (stored) void resumeStoredRun(stored.runId, stored.startedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every settled change persists; live streaming content lives outside
  // `messages` and never reaches storage. Skipped until hydration so the
  // initial empty state cannot wipe a stored transcript.
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveMessages(messages.map(toStoredBubble));
  }, [messages]);

  // One scroll container, one auto-scroll: the sentinel at the end of the log
  // is scrolled into view on every send and every reply. `smooth` is skipped
  // on the first paint so restoring a conversation does not animate.
  useEffect(() => {
    const target = endRef.current;
    const behavior: ScrollBehavior = firstScroll.current ? "auto" : "smooth";
    firstScroll.current = false;
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior, block: "end" });
      return;
    }
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, live !== null]);

  // Live MM:SS from the run's `createdAt`: recomputed from the wall clock so
  // a throttled tab still shows real elapsed time. It runs for the whole run
  // — content deltas no longer stop it.
  useEffect(() => {
    if (!live) return;
    const started = live.startedAt;
    const update = () => setElapsed(Math.floor((Date.now() - started) / 1000));
    update();
    const handle = window.setInterval(update, 1_000);
    return () => window.clearInterval(handle);
  }, [live?.startedAt]);

  // Streaming changes `live`, not `messages`: scroll on both.
  useEffect(() => {
    const target = endRef.current;
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [live]);

  // Leaving the page aborts our subscription, not the run: the pointer must
  // survive so the next mount can re-attach (S5). Clearing the ref first makes
  // the stream's failure path bail out instead of settling and deleting it.
  // A pending transport retry is ours, not the run's: cancel it too, so an
  // unmounted chat never re-subscribes behind the next mount.
  useEffect(
    () => () => {
      activeRunRef.current = null;
      // Invalidate the generation so a callback already queued in the
      // microtask queue cannot mutate state after unmount.
      streamGenRef.current += 1;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      abortRef.current?.abort();
    },
    [],
  );

  // Object URLs live only while the chip does.
  useEffect(
    () => () => {
      attachmentsRef.current.forEach(releaseAttachment);
    },
    [],
  );

  // Composer auto-growth (S3). The box is collapsed to `auto` and its
  // `scrollHeight` measured once per keystroke, then capped at the CSS
  // `max-h-40` (`COMPOSER_MAX_HEIGHT`) so it never eats the transcript. The
  // effect depends on `input` only — never on `live` — so streaming a reply
  // cannot re-measure and thrash the layout. Emptying the box (a send) drops
  // the inline height so `rows={1}` governs again.
  useEffect(() => {
    const box = inputRef.current;
    if (!box) return;
    if (input.length === 0) {
      box.style.height = "";
      return;
    }
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, [input]);

  function clearAttachments() {
    attachmentsRef.current.forEach(releaseAttachment);
    setAttachments([]);
    setUploadStatus({});
  }

  /** Drop only the chips that travelled with the successful turn. */
  function clearSentAttachments(ids: readonly string[]) {
    if (ids.length === 0) return;
    const sent = new Set(ids);
    setUploadStatus((prev) => {
      const next = { ...prev };
      sent.forEach((id) => delete next[id]);
      return next;
    });
    setAttachments((prev) => {
      const keep: PendingAttachment[] = [];
      prev.forEach((item) => {
        if (sent.has(item.id)) releaseAttachment(item);
        else keep.push(item);
      });
      return keep;
    });
  }

  function removeAttachment(id: string) {
    setUploadStatus((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) releaseAttachment(target);
      return prev.filter((item) => item.id !== id);
    });
  }

  /**
   * Composer copy for a rejected file. The planner already names the exact
   * rule that failed; `hermes.errorTooManyAttachments` stays the count message
   * because it is the one the i18n catalog already carries.
   */
  function rejectionNotice(rejection: AttachmentRejection): string {
    if (rejection.code === "count") return t(REJECTION_KEY);
    if (rejection.code === "size") {
      return `“${rejection.filename}” supera el límite de ${rejection.detail ?? ""} para su tipo.`;
    }
    return `“${rejection.filename}” no es un tipo de archivo admitido.`;
  }

  function addFiles(files: File[]) {
    if (files.length === 0) return;
    const { accepted, rejections } = planAttachments(attachmentsRef.current, files);
    if (accepted.length > 0) {
      setAttachments((prev) => [...prev, ...accepted]);
    }
    setNotice(
      rejections.length > 0 ? rejections.map(rejectionNotice).join(" ") : null,
    );
  }

  function pushError(
    code: HermesErrorCode,
    message: string | null,
    turn: { content: string; files: File[]; ids: string[] },
  ) {
    if (code === "session_expired") router.replace("/login/");
    setMessages((prev) => [
      ...prev,
      {
        id: bubbleId(),
        role: "error",
        code,
        message,
        retryContent: turn.content,
        retryFiles: turn.files,
        retryIds: [...turn.ids],
      },
    ]);
  }

  /** The authoritative output becomes the assistant bubble. */
  function pushAssistant(output: string, warnings: string[]) {
    // Owner spec S2: a reply is text and clean Markdown. Paths, `MEDIA:`
    // prefixes and `data:` payloads are no longer intercepted, so what Hermes
    // wrote is exactly what the bubble shows.
    const split = splitQuestion(output);
    setMessages((prev) => [
      ...prev,
      {
        id: bubbleId(),
        role: "assistant",
        content: split.text,
        warnings,
        thoughts: thoughtsRef.current,
        question: split.question,
        answered: null,
      },
    ]);
    setNotice(null);
  }

  function flushDeltas() {
    flushTimerRef.current = null;
    const chunk = pendingDeltaRef.current;
    pendingDeltaRef.current = "";
    if (!chunk) return;
    contentRef.current += chunk;
    const content = contentRef.current;
    const thoughts = thoughtsRef.current;
    setLive((prev) => (prev ? { ...prev, content, thoughts } : prev));
  }

  function scheduleFlush() {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(flushDeltas, 60);
  }

  function updateThoughts(next: (entries: ThoughtEntry[]) => ThoughtEntry[]) {
    thoughtsRef.current = next(thoughtsRef.current);
    const thoughts = thoughtsRef.current;
    setLive((prev) => (prev ? { ...prev, thoughts } : prev));
  }

  function handleEvent(payload: HermesRunEvent) {
    switch (payload.event) {
      case "message.delta": {
        // Deltas batch at most every 60 ms: re-rendering per token is O(n²).
        const delta = textOf(payload.delta);
        if (!delta) return;
        pendingDeltaRef.current += delta;
        scheduleFlush();
        return;
      }
      case "reasoning.available": {
        const text = textOf(payload.text);
        if (text) updateThoughts((entries) => appendThought(entries, text));
        return;
      }
      case "tool.started": {
        const tool = textOf(payload.tool);
        if (!tool) return;
        updateThoughts((entries) =>
          upsertTool(entries, {
            tool,
            label: textOf(payload.preview) ?? undefined,
            status: "running",
            toolCallId:
              textOf(payload.tool_call_id) ?? textOf(payload.toolCallId) ?? undefined,
          }),
        );
        return;
      }
      case "tool.completed": {
        const tool = textOf(payload.tool);
        if (!tool) return;
        updateThoughts((entries) =>
          upsertTool(entries, {
            tool,
            label: textOf(payload.preview) ?? undefined,
            status: "completed",
            toolCallId:
              textOf(payload.tool_call_id) ?? textOf(payload.toolCallId) ?? undefined,
          }),
        );
        return;
      }
      case "approval.request": {
        // Same mapper as the `pendingControls` resume path (MEDIUM-2): the
        // event and the stored control share the measured shape. An
        // unmappable gate is never silent: it sets the live unmappable flag
        // so the notice renders next to the run status until a card appears.
        const approval = approvalFromGate(payload, 0);
        if (!approval) {
          setLive((prev) => (prev ? { ...prev, approvalUnmappable: true } : prev));
          return;
        }
        setLive((prev) =>
          prev ? { ...prev, approval, approvalUnmappable: false } : prev,
        );
        return;
      }
      case "approval.settled": {
        // The gate expired (or was answered elsewhere): a pending card stops
        // offering buttons, an answered one is done and goes away.
        setLive((prev) => {
          if (!prev?.approval) return prev;
          const settledId = textOf(payload.prompt_id);
          if (settledId && settledId !== prev.approval.promptId) return prev;
          const decided =
            prev.approval.decision === "approved" || prev.approval.decision === "denied";
          return { ...prev, approval: decided ? null : { ...prev.approval, decision: "expired" } };
        });
        return;
      }
      default:
        return;
    }
  }

  /**
   * Drop the live bubble synchronously so it can never share a frame with
   * the settled bubble pushed right after; returns false for a stale run.
   */
  function clearRunState(runId: string, keepPointer = false): boolean {
    if (activeRunRef.current?.runId !== runId) return false;
    activeRunRef.current = null;
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    // A dead subscription is not a dead run: keeping the pointer lets the next
    // mount resume the stream or recover the finished output (S5/T10).
    if (!keepPointer) clearActiveRun();
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingDeltaRef.current = "";
    setLive(null);
    return true;
  }

  function handleTerminal(runId: string, payload: HermesRunEvent, sentIds: readonly string[]) {
    if (payload.event === "run.completed") {
      // Live goes away in the same tick the terminal lands; the authoritative
      // bubble follows async without ever sharing a frame with the draft.
      if (!clearRunState(runId)) return;
      const output =
        typeof payload.output === "string" ? payload.output : contentRef.current;
      clearSentAttachments(sentIds);
      // `pushAssistant` is synchronous now that output rendering is gone (S2):
      // draw the settled bubble, then release the queued turn.
      pushAssistant(output, []);
      pumpQueue();
    } else {
      // The failed turn itself is retryable; the queue still releases.
      if (!clearRunState(runId)) return;
      // JD-B-001: the chips belong to the turn that failed. Leaving them in the
      // composer made the next message re-upload and re-reference the same
      // files, so the follow-up carried the previous turn's attachments. The
      // error bubble keeps `retryFiles`, which is what Retry needs.
      clearSentAttachments(sentIds);
      pushError("upstream", terminalMessage(payload), { ...lastTurnRef.current });
      pumpQueue();
    }
  }

  /**
   * Shared recoverable exhaustion state (HIGH-1 + clean EOF): the stream is
   * gone but the run guard is still held. Keeps a visible status instead of
   * a frozen spinner; recovery is `retry()` (same run) or the new-
   * conversation escape hatch. Never pumps the queue.
   */
  function enterStreamLost(
    runId: string,
    code: HermesErrorCode,
    startedAt: number,
    initialApproval: ApprovalRequest | null,
  ) {
    if (activeRunRef.current?.runId !== runId) return;
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingDeltaRef.current = "";
    pushError(code, null, { ...lastTurnRef.current });
    const lostStartedAt = activeRunRef.current?.startedAt ?? startedAt;
    setLive((prev) =>
      prev
        ? { ...prev, streamLost: true }
        : {
            content: contentRef.current,
            thoughts: thoughtsRef.current,
            startedAt: lostStartedAt,
            approval: initialApproval,
            streamLost: true,
            approvalUnmappable: false,
          },
    );
  }

  /**
   * Settle a run already known to be terminal (clean-EOF confirm + resume).
   * Clears the guard when this tab holds it (clean-EOF case; no-op on
   * mount), drops the stored pointer, then recovers through the same
   * output/error path a live terminal uses, with the same duplicate guard.
   */
  async function recoverSettledStatus(
    runId: string,
    status: { status: string; output: string; error: string | null },
  ) {
    if (activeRunRef.current?.runId === runId) {
      activeRunRef.current = null;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingDeltaRef.current = "";
      setLive(null);
    }
    clearActiveRun();
    if (status.status === "completed" && status.output.trim().length > 0) {
      const output = status.output;
      const last = messagesRef.current[messagesRef.current.length - 1];
      // Same transformation as `pushAssistant`, so a resumed run is not
      // appended twice on top of the bubble that was already stored.
      const prose = splitQuestion(output).text;
      if (last?.role !== "assistant" || (last.content !== output && last.content !== prose)) {
        thoughtsRef.current = [];
        pushAssistant(output, []);
      }
    } else if (status.error && status.error.trim().length > 0) {
      pushError("upstream", status.error, { content: "", files: [], ids: [] });
    }
  }

  function attachStream(
    runId: string,
    startedAt: number,
    sentIds: readonly string[],
    initialApproval: ApprovalRequest | null = null,
    initialUnmappable = false,
  ) {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    // Next generation wins: late callbacks from any previous subscription —
    // even for the same run — are ignored at every delivery point below.
    const generation = streamGenRef.current + 1;
    streamGenRef.current = generation;
    abortRef.current?.abort();
    activeRunRef.current = { runId, startedAt };
    setElapsed(0);
    setLive((prev) => ({
      content: contentRef.current,
      thoughts: thoughtsRef.current,
      startedAt,
      approval: initialApproval ?? prev?.approval ?? null,
      streamLost: false,
      approvalUnmappable: initialApproval
        ? false
        : initialUnmappable
          ? true
          : (prev?.approvalUnmappable ?? false),
    }));
    // Set once a terminal lands for this generation: a clean EOF right after
    // (the test harness pushes the terminal then closes) must not double-settle.
    let terminalSeen = false;
    const startSubscription = (signal: AbortSignal, attempt: number) => {
      // A clean 2xx EOF without a terminal is a dirty end for this
      // generation only (HIGH): confirm once with the run status — a run
      // already terminal settles through the shared resume path — otherwise
      // enter the same recoverable `streamLost` state as exhausted retries.
      const handleCleanEof = () => {
        if (streamGenRef.current !== generation) return;
        if (activeRunRef.current?.runId !== runId) return;
        if (terminalSeen) return;
        void getHermesRun(runId).then(
          (status) => {
            if (streamGenRef.current !== generation) return;
            if (activeRunRef.current?.runId !== runId) return;
            if (terminalSeen) return;
            if (
              !isHermesRunActive(status.status) &&
              !hasPendingControls(status.pendingControls)
            ) {
              terminalSeen = true;
              void recoverSettledStatus(runId, status);
              return;
            }
            enterStreamLost(runId, "network", startedAt, initialApproval);
          },
          () => {
            if (streamGenRef.current !== generation) return;
            if (activeRunRef.current?.runId !== runId) return;
            if (terminalSeen) return;
            enterStreamLost(runId, "network", startedAt, initialApproval);
          },
        );
      };
      void streamHermesRun(
        runId,
        {
          onEvent: (payload) => {
            if (streamGenRef.current !== generation) return;
            handleEvent(payload);
          },
          onTerminal: (payload) => {
            if (streamGenRef.current !== generation) return;
            terminalSeen = true;
            handleTerminal(runId, payload, sentIds);
          },
        },
        signal,
      ).then(
        () => {
          handleCleanEof();
        },
        (error: unknown) => {
        // Our own abort is a navigation away, not a failure.
        if (error instanceof Error && error.name === "AbortError") return;
        // Superseded subscription (same run, older generation): a late
        // failure must not schedule retries or enter `streamLost` on behalf
        // of the current one.
        if (streamGenRef.current !== generation) return;
        if (activeRunRef.current?.runId !== runId) return;
        const code = error instanceof HermesError ? error.code : "network";
        // The subscription died, not the run: the gateway keeps executing
        // and replays the backlog on re-subscribe. Only transient failures
        // (`network`/`unavailable`/`timeout`) spend the bounded backoff
        // (~1 s then ~3 s), so a blip never starts a second run while the
        // first is still alive (JD-B-001). A 4xx falls through to the
        // exhaustion state immediately without burning the retry budget.
        if (isTransientStreamCode(code) && attempt < STREAM_RETRY_DELAYS_MS.length) {
          const delay = STREAM_RETRY_DELAYS_MS[attempt];
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            if (streamGenRef.current !== generation) return;
            if (activeRunRef.current?.runId !== runId) return;
            // Reset the in-flight draft: the replayed backlog rebuilds it
            // from zero, so keeping the partial would duplicate content.
            if (flushTimerRef.current !== null) {
              window.clearTimeout(flushTimerRef.current);
              flushTimerRef.current = null;
            }
            pendingDeltaRef.current = "";
            contentRef.current = "";
            thoughtsRef.current = [];
            setLive((prev) =>
              prev
                ? { ...prev, content: "", thoughts: [] }
                : {
                    content: "",
                    thoughts: [],
                    startedAt,
                    approval: initialApproval,
                    streamLost: false,
                    approvalUnmappable: initialUnmappable,
                  },
            );
            const next = new AbortController();
            abortRef.current = next;
            startSubscription(next.signal, attempt + 1);
          }, delay);
          return;
        }
        // Retries exhausted (or a non-transient failure on the first try):
        // HIGH-1 recoverable state. The run guard and the stored pointer
        // stay held, the queue is never pumped, and `live` keeps a visible
        // `streamLost` status instead of dropping to null — so `live` is
        // never null while `activeRunRef` is set. Recovery is `retry()`
        // (re-attaches this same run) or `startNewConversation` (the
        // explicit escape hatch once the stream is lost). The queue
        // releases on a terminal event, on unmount, or on the next mount's
        // resume — never because a stream died.
        enterStreamLost(runId, code, startedAt, initialApproval);
        });
    };
    const controller = new AbortController();
    abortRef.current = controller;
    startSubscription(controller.signal, 0);
  }

  /**
   * Persist the receipt of every uploaded attachment into the waiting user
   * bubble, keyed by the pending chip id. This is what lets the transcript
   * repaint an image or a video after a reload (S5): `url`, `mime_type` and
   * `local_path` come only from S4's `/api/uploads` answer.
   */
  function recordStoredUploads(stored: ReadonlyMap<string, HermesUploadedFile>) {
    if (stored.size === 0) return;
    setMessages((prev) =>
      prev.map((bubble) => {
        if (bubble.role !== "user") return bubble;
        if (!bubble.attachments.some((item) => stored.has(item.key))) return bubble;
        return {
          ...bubble,
          attachments: bubble.attachments.map((item) => {
            const upload = stored.get(item.key);
            return upload
              ? {
                  ...item,
                  url: upload.url,
                  mime_type: upload.mime_type,
                  local_path: upload.local_path,
                }
              : item;
          }),
        };
      }),
    );
  }

  async function startRun(content: string, files: File[], sentIds: readonly string[]) {
    const session = sessionRef.current;
    if (!session) {
      syncStarting(false);
      return;
    }
    lastTurnRef.current = { content, files, ids: [...sentIds] };
    thoughtsRef.current = [];
    contentRef.current = "";
    pendingDeltaRef.current = "";
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    // S4 + D-B1: every attachment goes to `/api/uploads` first, one request
    // per file, all in flight at once. The receipt is the only source of the
    // path Hermes reads and of the url the transcript repaints from.
    const items = sentIds.flatMap((id, index) => {
      const file = files[index];
      if (!(file instanceof File)) return [];
      const kind: AttachmentKind =
        attachmentsRef.current.find((item) => item.id === id)?.kind ??
        classifyFile(file) ??
        "document";
      return [{ id, file, kind }];
    });
    let uploaded: { id: string; kind: AttachmentKind; file: File; receipt: HermesUploadedFile }[];
    // One batch, one abort: a rejected file must stop its siblings instead of
    // letting a 100 MB video finish uploading into a turn that will never be
    // sent. The timer bounds a stalled request, so a chip cannot stay on
    // "uploading" forever while the error bubble already retried the turn.
    const batch = new AbortController();
    // JD-B-009: a fixed two minutes fails a 100 MB video on any uplink slower
    // than ~6.7 Mbit/s. The deadline follows the largest file, keeping a floor
    // for small ones and a generous 4 s/MB budget for the ceiling of S3.
    const budget = Math.max(
      UPLOAD_TIMEOUT_MS,
      ...items.map((item) => Math.ceil(item.file.size / (1024 * 1024)) * 4_000),
    );
    const timeout = AbortSignal.timeout(budget);
    const signal =
      typeof AbortSignal.any === "function" ? AbortSignal.any([batch.signal, timeout]) : batch.signal;
    try {
      uploaded = await Promise.all(
        items.map(async (item) => {
          setUploadStatus((prev) => ({ ...prev, [item.id]: "uploading" }));
          try {
            const receipt = await uploadHermesFile(item.file, signal);
            setUploadStatus((prev) => ({ ...prev, [item.id]: "ready" }));
            return { ...item, receipt };
          } catch (error) {
            setUploadStatus((prev) => ({ ...prev, [item.id]: "error" }));
            batch.abort();
            throw error;
          }
        }),
      );
    } catch (error) {
      // A rejected upload sends nothing: the error bubble keeps the turn and
      // its chips for a retry, and the server's own message is what it shows.
      syncStarting(false);
      const code = error instanceof HermesError ? error.code : "network";
      const message = error instanceof HermesError ? error.message : null;
      // JD-B-001 applies to this failure too: the chips travelled with the turn
      // that just failed, so they must not ride along with the next message.
      clearSentAttachments(sentIds);
      pushError(code, message, { content, files, ids: [...sentIds] });
      pumpQueue();
      return;
    }
    recordStoredUploads(new Map(uploaded.map((item) => [item.id, item.receipt])));
    // S4: an image ≤ 5 MB travels inline as an `image_url` part; everything
    // else is uploaded once and referenced by the path the server chose, so a
    // 100 MB video never enters the Runs payload.
    const turnText = composeTurnText(
      content,
      uploaded.filter((item) => !travelsInline(item.kind)).map((item) => item.receipt),
    );
    // JD-B-006: the runs proxy decides `image_url` by the part's MIME, and the
    // browser's guess is not evidence. Relabel each inline image with the type
    // the server sniffed, or a `.png` sent as octet-stream would degrade to a
    // text descriptor and the model would never see the picture.
    const turnFiles = uploaded
      .filter((item) => travelsInline(item.kind))
      .map(
        (item) =>
          new File([item.file], item.file.name, { type: item.receipt.mime_type || item.file.type }),
      );
    let created: { runId: string; createdAt: number };
    try {
      created = await createHermesRun(session, { content: turnText, files: turnFiles });
    } catch (error) {
      syncStarting(false);
      const code = error instanceof HermesError ? error.code : "network";
      clearSentAttachments(sentIds);
      pushError(code, null, { content, files, ids: [...sentIds] });
      pumpQueue();
      return;
    }
    syncStarting(false);
    saveActiveRun({ sessionId: session, runId: created.runId, startedAt: created.createdAt });
    attachStream(created.runId, created.createdAt, sentIds);
  }

  /** Start now, or wait behind the active run without aborting it. */
  function queueOrStart(content: string, files: File[], ids: readonly string[], bubbleId: number | null) {
    if (startingRef.current || activeRunRef.current !== null) {
      queueRef.current.push({ bubbleId, content, files, ids: [...ids] });
      return;
    }
    startingRef.current = true;
    setStarting(true);
    void startRun(content, files, ids);
  }

  /** One run at a time: the next waiting turn goes when the run settles. */
  function pumpQueue() {
    if (startingRef.current || activeRunRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    if (next.bubbleId !== null) {
      const id = next.bubbleId;
      setMessages((prev) =>
        prev.map((bubble) =>
          bubble.id === id && bubble.role === "user" ? { ...bubble, queued: false } : bubble,
        ),
      );
    }
    startingRef.current = true;
    setStarting(true);
    void startRun(next.content, next.files, next.ids);
  }

  /** Re-attach to a run that outlived a page refresh. */
  async function resumeStoredRun(runId: string, startedAt: number) {
    let status;
    try {
      status = await getHermesRun(runId);
    } catch {
      clearActiveRun();
      return;
    }
    if (!isHermesRunActive(status.status) && !hasPendingControls(status.pendingControls)) {
      // Finished while we were away: recover through the shared settled
      // path (also used by the clean-EOF confirm), then drop the pointer.
      await recoverSettledStatus(runId, status);
      return;
    }
    thoughtsRef.current = [];
    contentRef.current = "";
    pendingDeltaRef.current = "";
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    // The gateway reports `created_at` in epoch seconds; the UI works in ms.
    const createdMs = Number.isFinite(status.createdAt)
      ? status.createdAt < 1e12
        ? status.createdAt * 1000
        : status.createdAt
      : startedAt;
    saveActiveRun({ sessionId: sessionRef.current ?? "", runId, startedAt: createdMs });
    // A refresh while parked on a gate must restore the card at once
    // (JD-B-002): the backlog may not re-emit `approval.request` before the
    // 60 s gate expires, so rebuild from `pendingControls` with the same
    // mapper the live event uses. The timer keeps running from `createdAt`.
    // Safety net (MEDIUM-2): a non-empty `pendingControls` that cannot be
    // mapped is never silent — the live unmappable flag renders next to the
    // run status (unaffected by attachment actions), keeps the pointer (so a
    // reload can retry the mapping), and still attaches, so the run never
    // looks like a normal running run. The flag clears when a card renders
    // or the run settles (live goes null).
    const pending =
      Array.isArray(status.pendingControls) && status.pendingControls.length > 0
        ? status.pendingControls
        : null;
    const initialApproval = pending
      ? approvalFromGate(pending[0], status.executionGeneration)
      : null;
    const initialUnmappable = Boolean(pending) && !initialApproval;
    attachStream(runId, createdMs, [], initialApproval, initialUnmappable);
  }

  /** Mark the turn's chips as waiting, before the first upload starts. */
  function markQueued(ids: readonly string[]) {
    if (ids.length === 0) return;
    setUploadStatus((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = "queued";
      return next;
    });
  }

  /** Push a user bubble and start now, or queue behind the active run. */
  function sendTurn(content: string, files: File[], sentIds: readonly string[]) {
    const sent = new Set(sentIds);
    const pending = attachmentsRef.current.filter((item) => sent.has(item.id));
    const queued = startingRef.current || activeRunRef.current !== null;
    const id = bubbleId();
    setMessages((prev) => [
      ...prev,
      {
        id,
        role: "user",
        content,
        attachments: pending.map<SentAttachment>((item) => ({
          key: item.id,
          name: item.file.name,
          size: item.file.size,
          kind: item.kind,
          previewUrl: item.previewUrl,
        })),
        queued,
      },
    ]);
    markQueued(sentIds);
    queueOrStart(content, files, sentIds, id);
  }

  /** Answering the card sends a normal turn and locks that card. */
  function answerQuestion(messageId: number, answer: string) {
    setMessages((prev) =>
      prev.map((bubble) =>
        bubble.id === messageId && bubble.role === "assistant"
          ? { ...bubble, answered: answer }
          : bubble,
      ),
    );
    sendTurn(answer, [], []);
    inputRef.current?.focus();
  }

  function resolveApproval(choice: "once" | "deny") {
    const run = activeRunRef.current;
    const approval = live?.approval;
    if (!run || !approval || approval.decision === "expired" || approval.decision === "pending") {
      return;
    }
    const promptId = approval.promptId;
    setLive((prev) =>
      prev?.approval && prev.approval.promptId === promptId
        ? { ...prev, approval: { ...prev.approval, decision: "pending", error: null } }
        : prev,
    );
    void resolveHermesApproval(run.runId, {
      requestId: approval.promptId,
      executionGeneration: approval.executionGeneration,
      choice,
    })
      .then(() => {
        setLive((inner) =>
          inner?.approval && inner.approval.promptId === promptId
            ? {
                ...inner,
                approval: {
                  ...inner.approval,
                  decision: (choice === "once" ? "approved" : "denied") as ApprovalDecision,
                  error: null,
                },
              }
            : inner,
        );
      })
      .catch(() => {
        // The run keeps streaming: only the card shows the failure.
        setLive((inner) =>
          inner?.approval && inner.approval.promptId === promptId
            ? {
                ...inner,
                approval: {
                  ...inner.approval,
                  decision: "idle",
                  error: t("hermes.errorUpstream"),
                },
              }
            : inner,
        );
      });
  }

  function submit() {
    const content = input.trim();
    const pending = attachmentsRef.current;
    if ((!content && pending.length === 0) || !sessionId) return;
    setInput("");
    sendTurn(
      content,
      pending.map((item) => item.file),
      pending.map((item) => item.id),
    );
    inputRef.current?.focus();
  }

  function retry(message: Extract<Bubble, { role: "error" }>) {
    // HIGH-1 + resumed-run fix: the guarded branch comes first, so a run
    // resumed after a refresh (whose error bubble carries no text) still
    // re-attaches that SAME run. Only when no run is guarded does an empty
    // turn bail out — and then the button is hidden at render time, so this
    // is a safety net, never a visible no-op.
    const guarded = activeRunRef.current;
    if (guarded) {
      setMessages((prev) => prev.filter((bubble) => bubble.id !== message.id));
      inputRef.current?.focus();
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingDeltaRef.current = "";
      contentRef.current = "";
      thoughtsRef.current = [];
      attachStream(guarded.runId, guarded.startedAt, message.retryIds);
      return;
    }
    // A recovered failure has no turn to re-send: retrying thin air must not
    // open an empty run.
    if (
      !message.retryContent &&
      message.retryFiles.length === 0 &&
      message.retryIds.length === 0
    ) {
      inputRef.current?.focus();
      return;
    }
    setMessages((prev) => prev.filter((bubble) => bubble.id !== message.id));
    inputRef.current?.focus();
    // The user bubble is already on screen: re-send without drawing it twice.
    // Like any send, it queues behind a running run instead of aborting it.
    markQueued(message.retryIds);
    queueOrStart(message.retryContent, message.retryFiles, message.retryIds, null);
  }

  function startNewConversation() {
    // HIGH-1 escape-hatch behaviour (chosen over both "always enabled" and
    // "always disabled while a guard exists"): the button stays disabled
    // while a run is genuinely live (guard held, stream healthy) so a click
    // can never orphan a gateway execution into a second run (JD-B-001
    // one-run invariant); once the stream is lost (`live.streamLost`) the
    // same button becomes the explicit exit from the recoverable exhaustion
    // state, clearing the pointer, the guard, the queue and the live bubble.
    // A stuck-but-abandonable run is better than a chat that only a reload
    // can leave (and a reload loses `queueRef` entirely).
    const streamLost = live?.streamLost === true;
    const genuinelyLive = (activeRunRef.current !== null || startingRef.current) && !streamLost;
    if (genuinelyLive) return;
    abortRef.current?.abort();
    // Invalidate any in-flight deliveries from the abandoned subscription.
    streamGenRef.current += 1;
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingDeltaRef.current = "";
    contentRef.current = "";
    thoughtsRef.current = [];
    activeRunRef.current = null;
    syncStarting(false);
    queueRef.current = [];
    setLive(null);
    const id = newSessionId();
    saveSessionId(id);
    setSessionId(id);
    setMessages([]);
    clearMessages();
    clearActiveRun();
    setInput("");
    clearAttachments();
    setNotice(null);
    inputRef.current?.focus();
  }

  // Disabled while a run is genuinely live (healthy stream) or a create is
  // in flight; enabled once the stream is lost (HIGH-1 escape hatch) and
  // when idle. `starting` mirrors `startingRef` as state so the button looks
  // disabled during a large multipart upload instead of a silently disabled
  // no-op.
  const runActive = (live !== null && live.streamLost !== true) || starting;
  const canSend = Boolean(sessionId) && (input.trim().length > 0 || attachments.length > 0);

  return (
    <section
      data-testid="hermes-dropzone"
      onDragOver={(event) => {
        if (event.dataTransfer?.types?.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        addFiles(Array.from(event.dataTransfer?.files ?? []));
        inputRef.current?.focus();
      }}
      className={`flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-panel transition-colors ${
        dragging ? "border-sky-400/70 ring-2 ring-sky-400/30" : "border-hair"
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hair px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">
            {t("hermes.kicker")}
          </p>
          <h1 className="flex items-baseline gap-2 text-lg font-bold tracking-tight">
            Hermes
            {sessionId ? (
              <span
                title={sessionId}
                className="hidden font-mono text-[10px] font-normal text-muted sm:inline"
              >
                {t("hermes.session", { id: sessionId.slice(0, 8) })}
              </span>
            ) : null}
          </h1>
        </div>
        <button
          type="button"
          onClick={startNewConversation}
          disabled={runActive}
          className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-300 transition-colors hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("hermes.newConversation")}
        </button>
      </header>

      {dragging ? (
        <p
          data-testid="hermes-drop-hint"
          className="border-b border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs font-medium text-sky-200 sm:px-6"
        >
          {t("hermes.dropHint")}
        </p>
      ) : null}

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t("hermes.logLabel")}
        data-testid="hermes-log"
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-6"
      >
        {messages.length === 0 && !runActive ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-400">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-6 w-6">
                <path
                  d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.35"
                />
                <path
                  d="M12 6l-5 3v3c0 3.5 2.5 6.8 5 7.5 2.5-.7 5-4 5-7.5V9l-5-3z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M9 12h6M12 9v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <p className="text-sm font-semibold text-instrument">{t("hermes.emptyTitle")}</p>
            <p className="max-w-sm text-xs leading-relaxed text-muted">{t("hermes.emptyBody")}</p>
            <p className="max-w-sm text-[11px] leading-relaxed text-muted/80">
              {t("hermes.dropHint")}
            </p>
          </div>
        ) : null}

        {messages.map((message) => {
          if (message.role === "error") {
            return (
              <div
                key={message.id}
                data-role="error"
                className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 sm:max-w-[85%]"
              >
                <p className="leading-relaxed">{message.message ?? t(errorKey(message.code))}</p>
                {(() => {
                  const retryableCode =
                    message.code !== "too_long" &&
                    message.code !== "too_large" &&
                    message.code !== "too_many_attachments" &&
                    message.code !== "session_expired";
                  // A resumed run's error bubble carries no text but the run
                  // is still guarded: Retry re-attaches that run. With no
                  // guard and no text the button would be a no-op, so hide it.
                  const hasTurn =
                    message.retryContent.length > 0 ||
                    message.retryFiles.length > 0 ||
                    message.retryIds.length > 0;
                  return retryableCode && (hasTurn || live !== null) ? (
                  <button
                    type="button"
                    onClick={() => retry(message)}
                    className="mt-2 rounded-md border border-rose-400/40 px-2.5 py-1 text-xs font-semibold text-rose-100 transition-colors hover:bg-rose-500/20 disabled:opacity-50"
                  >
                    {t("hermes.retry")}
                  </button>
                ) : null;})()}
              </div>
            );
          }
          const isUser = message.role === "user";
          return (
            <div
              key={message.id}
              data-role={message.role}
              data-queued={isUser && message.queued ? "true" : undefined}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`min-w-0 max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                  isUser
                    ? "rounded-br-md bg-sky-500/15 text-instrument"
                    : "rounded-bl-md border border-hair bg-card text-slate-200"
                }`}
              >
                <p className="sr-only">{isUser ? t("hermes.you") : t("hermes.assistant")}</p>
                {isUser ? (
                  <>
                    {message.content ? (
                      <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    ) : null}
                    {message.attachments.length > 0 ? (
                      <ul
                        aria-label={t("hermes.attachmentsLabel")}
                        className={`flex w-full min-w-0 flex-wrap items-start gap-1.5 ${message.content ? "mt-2" : ""}`}
                      >
                        {message.attachments.map((item, index) => (
                          <li
                            key={`${message.id}-attachment-${index}`}
                            className="flex min-w-0 max-w-full"
                          >
                            <UserAttachment attachment={item} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {message.queued ? (
                      <p className="mt-1.5 text-[11px] font-medium text-sky-300">
                        {t("hermes.queued")}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <ThoughtAccordion entries={message.thoughts} />
                    <div data-testid="hermes-markdown">
                      <HermesMessageBody content={message.content} final />
                    </div>
                    {message.warnings.length > 0 ? (
                      <ul
                        role="note"
                        aria-label={t("hermes.warningsLabel")}
                        className="mt-3 space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200"
                      >
                        {message.warnings.map((warning, index) => (
                          <li key={`${message.id}-warning-${index}`}>{warning}</li>
                        ))}
                      </ul>
                    ) : null}
                    {message.question ? (
                      <InteractiveQuestionCard
                        question={message.question}
                        answered={message.answered}
                        onAnswer={(answer) => answerQuestion(message.id, answer)}
                      />
                    ) : null}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {live && live.content.length > 0 ? (
          <div data-role="assistant" data-streaming="true" className="flex justify-start">
            <div className="min-w-0 max-w-[85%] rounded-2xl rounded-bl-md border border-hair bg-card px-4 py-2.5 text-sm text-slate-200">
              <p className="sr-only">{t("hermes.assistant")}</p>
              <ThoughtAccordion entries={live.thoughts} />
              <div data-testid="hermes-markdown">
                <HermesMessageBody content={live.content} final={false} />
              </div>
              {live.approval ? (
                <ApprovalRequestCard
                  tool={live.approval.tool}
                  command={live.approval.command}
                  description={live.approval.description}
                  decision={live.approval.decision}
                  error={live.approval.error}
                  onApprove={() => resolveApproval("once")}
                  onDeny={() => resolveApproval("deny")}
                />
              ) : null}
            </div>
          </div>
        ) : live && live.thoughts.length > 0 ? (
          // Nothing rendered yet: the thought header floats above the status
          // line instead of drawing an empty bubble around itself.
          <div data-role="assistant" data-streaming="true" className="px-1">
            <p className="sr-only">{t("hermes.assistant")}</p>
            <ThoughtAccordion entries={live.thoughts} streaming />
            {live.approval ? (
              <ApprovalRequestCard
                tool={live.approval.tool}
                command={live.approval.command}
                description={live.approval.description}
                decision={live.approval.decision}
                error={live.approval.error}
                onApprove={() => resolveApproval("once")}
                onDeny={() => resolveApproval("deny")}
              />
            ) : null}
          </div>
        ) : live?.approval ? (
          <div data-role="assistant" data-streaming="true" className="px-1">
            <p className="sr-only">{t("hermes.assistant")}</p>
            <ApprovalRequestCard
              tool={live.approval.tool}
              command={live.approval.command}
              description={live.approval.description}
              decision={live.approval.decision}
              error={live.approval.error}
              onApprove={() => resolveApproval("once")}
              onDeny={() => resolveApproval("deny")}
            />
          </div>
        ) : null}

        {live ? (
          <div role="status" className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span aria-hidden="true" className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400 [animation-delay:-0.2s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400 [animation-delay:-0.1s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400" />
            </span>
            <span>{live.streamLost ? STREAM_LOST_STATUS : t("hermes.working")}</span>
            {/* Decorative: the status text is announced once, not every tick. */}
            <span
              aria-hidden="true"
              data-testid="hermes-elapsed"
              className="font-mono tabular-nums text-sky-300"
            >
              ⏱️ {formatElapsed(elapsed)}
            </span>
            {live.approvalUnmappable && !live.approval ? (
              <span
                role="alert"
                className="basis-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
              >
                {UNMAPPABLE_APPROVAL_NOTICE}
              </span>
            ) : null}
          </div>
        ) : null}
        <div ref={endRef} aria-hidden="true" className="h-px w-full" />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="sticky bottom-0 z-10 shrink-0 border-t border-hair bg-panel/95 px-4 py-3 backdrop-blur sm:px-6"
      >
        <label htmlFor="hermes-input" className="sr-only">
          {t("hermes.placeholder")}
        </label>

        {notice ? (
          <p
            role="alert"
            className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
          >
            {notice}
          </p>
        ) : null}

        <AttachmentBar
          items={attachments}
          onRemove={removeAttachment}
          disabled={starting}
          statusOf={(id) => uploadStatus[id]}
        />

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!sessionId}
            aria-label={t("hermes.attach")}
            title={t("hermes.attach")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-hair bg-deck text-muted transition-colors hover:border-sky-500/40 hover:text-sky-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
              <path
                d="M12.5 6.5l-5.6 5.6a2.4 2.4 0 003.4 3.4l6-6a4 4 0 10-5.7-5.7l-6 6a5.6 5.6 0 007.9 7.9"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            data-testid="hermes-file-input"
            tabIndex={-1}
            aria-hidden="true"
            className="sr-only"
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />

          <MicButton
            disabled={!sessionId}
            onRecorded={(file) => addFiles([file])}
          />

          <textarea
            id="hermes-input"
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPaste={(event) => {
              // S3: a screenshot pasted with Ctrl+V / Cmd+V becomes an
              // attachment through the same planner as the clip and the drop.
              // Plain text paste is untouched: the default is never prevented.
              const pasted = Array.from(event.clipboardData?.files ?? []);
              if (pasted.length > 0) addFiles(pasted);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={t("hermes.placeholder")}
            disabled={!sessionId}
            className="max-h-40 min-h-[44px] min-w-0 flex-1 resize-none rounded-lg border border-hair bg-deck px-3 py-2.5 text-sm text-instrument placeholder:text-muted focus-visible:outline-2 focus-visible:outline-signal disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label={t("hermes.send")}
            className="flex min-h-[44px] shrink-0 items-center justify-center rounded-lg bg-signal px-3 py-2.5 text-sm font-semibold text-deck transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:px-4"
          >
            <span className="hidden sm:inline">{t("hermes.send")}</span>
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5 sm:hidden">
              <path d="M3.5 10h9M8.5 5.5L13 10l-4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted">
          <span className="hidden sm:inline">{t("hermes.hint")}</span>
          <span className="inline-flex items-center gap-1">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3 w-3">
              <path d="M10 3.5l6 2.5v4.4c0 3.9-2.6 6.2-6 7.6-3.4-1.4-6-3.7-6-7.6V6l6-2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
            {t("hermes.attachHint")}
          </span>
        </div>
      </form>
    </section>
  );
}
