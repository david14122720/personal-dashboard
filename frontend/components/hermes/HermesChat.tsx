"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ArtifactCard from "@/components/hermes/ArtifactCard";
import AttachmentBar from "@/components/hermes/AttachmentBar";
import HermesMarkdown from "@/components/hermes/HermesMarkdown";
import InteractiveQuestionCard from "@/components/hermes/InteractiveQuestionCard";
import MicButton from "@/components/hermes/MicButton";
import ThoughtAccordion, { type ThoughtEntry } from "@/components/hermes/ThoughtAccordion";
import {
  HermesError,
  type HermesErrorCode,
  type HermesToolEvent,
  sendHermesTurnStream,
  signHermesMedia,
} from "@/lib/api/hermes";
import { collectArtifacts, type Artifact } from "@/lib/hermes/artifacts";
import { formatElapsed } from "@/lib/hermes/elapsed";
import { scanMediaPaths } from "@/lib/hermes/paths";
import { splitQuestion, type HermesQuestion } from "@/lib/hermes/questions";
import {
  planAttachments,
  releaseAttachment,
  type AttachmentKind,
  type PendingAttachment,
} from "@/lib/hermes/attachments";
import { loadOrCreateSessionId, newSessionId, saveSessionId } from "@/lib/hermes/session";
import { t } from "@/lib/i18n";

interface SentAttachment {
  name: string;
  size: number;
  kind: AttachmentKind;
}

type Bubble =
  | { id: number; role: "user"; content: string; attachments: SentAttachment[] }
  | {
      id: number;
      role: "assistant";
      content: string;
      artifacts: Artifact[];
      warnings: string[];
      thoughts: ThoughtEntry[];
      question: HermesQuestion | null;
      answered: string | null;
    }
  | {
      id: number;
      role: "error";
      code: HermesErrorCode;
      retryContent: string;
      retryFiles: File[];
      retryIds: string[];
    };

let nextBubbleId = 1;
function bubbleId(): number {
  const id = nextBubbleId;
  nextBubbleId += 1;
  return id;
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
/** Matches the backend default; replaced by the proxy's `start` event. */
const DEFAULT_TIMEOUT_MS = 600_000;

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
  // A completion frame may only carry `status`: keep the label/emoji captured
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
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState<{
    content: string;
    thoughts: ThoughtEntry[];
    firstDelta: boolean;
    timeoutMs: number;
    startedAt: number;
    waitingAgain: boolean;
  } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const thoughtsRef = useRef<ThoughtEntry[]>([]);
  const pendingDeltaRef = useRef("");
  const flushTimerRef = useRef<number | null>(null);
  const retryTurnRef = useRef<{ content: string; files: File[]; ids: string[] }>({
    content: "",
    files: [],
    ids: [],
  });
  const logRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const firstScroll = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  attachmentsRef.current = attachments;

  // Recover or mint the UUID after mount: the static export prerenders this
  // page, and localStorage does not exist on the server.
  useEffect(() => {
    setSessionId(loadOrCreateSessionId());
  }, []);

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
  }, [messages, sending]);

  // Live MM:SS: recomputed from the wall clock so a throttled tab still shows
  // real elapsed time. It stops as soon as the first content delta renders.
  useEffect(() => {
    if (!live || live.firstDelta) return;
    const started = live.startedAt;
    const update = () => setElapsed(Math.floor((Date.now() - started) / 1000));
    update();
    const handle = window.setInterval(update, 1_000);
    return () => window.clearInterval(handle);
  }, [live?.startedAt, live?.firstDelta]);

  // Streaming changes `live`, not `messages`: scroll on both.
  useEffect(() => {
    const target = endRef.current;
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [live]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Object URLs live only while the chip does.
  useEffect(
    () => () => {
      attachmentsRef.current.forEach(releaseAttachment);
    },
    [],
  );

  function clearAttachments() {
    attachmentsRef.current.forEach(releaseAttachment);
    setAttachments([]);
  }

  /** Drop only the chips that travelled with the successful turn. */
  function clearSentAttachments(ids: readonly string[]) {
    if (ids.length === 0) return;
    const sent = new Set(ids);
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
    setAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) releaseAttachment(target);
      return prev.filter((item) => item.id !== id);
    });
  }

  function addFiles(files: File[]) {
    if (files.length === 0) return;
    const { accepted, rejection } = planAttachments(attachmentsRef.current, files);
    if (accepted.length > 0) {
      setAttachments((prev) => [...prev, ...accepted]);
    }
    if (rejection) {
      setNotice(
        t(REJECTION_KEY, {
          name: rejection.filename ?? "",
        }),
      );
    } else {
      setNotice(null);
    }
  }

  async function request(content: string, files: File[], sentIds: readonly string[]) {
    if (!sessionId) return;
    // One in-flight turn at a time: a retry replaces the previous controller.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    retryTurnRef.current = { content, files, ids: [...sentIds] };
    thoughtsRef.current = [];
    pendingDeltaRef.current = "";
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    setSending(true);
    setElapsed(0);
    setLive({
      content: "",
      thoughts: [],
      firstDelta: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      startedAt: Date.now(),
      waitingAgain: false,
    });

    const updateThoughts = (next: (entries: ThoughtEntry[]) => ThoughtEntry[]) => {
      thoughtsRef.current = next(thoughtsRef.current);
      setLive((prev) => (prev ? { ...prev, thoughts: thoughtsRef.current } : prev));
    };

    try {
      const result = await sendHermesTurnStream(
        sessionId,
        { content, files },
        {
          onStart: (timeoutMs) =>
            setLive((prev) => (prev ? { ...prev, timeoutMs } : prev)),
          onThinking: (text) => updateThoughts((entries) => appendThought(entries, text)),
          onTool: (tool) => updateThoughts((entries) => upsertTool(entries, tool)),
          onDelta: (text) => {
            // The clock stops on the first token, but the text is flushed at
            // most every 60 ms: re-parsing the whole reply per token is O(n²).
            setLive((prev) => (prev ? { ...prev, firstDelta: true } : prev));
            pendingDeltaRef.current += text;
            if (flushTimerRef.current !== null) return;
            flushTimerRef.current = window.setTimeout(() => {
              flushTimerRef.current = null;
              const chunk = pendingDeltaRef.current;
              pendingDeltaRef.current = "";
              if (!chunk) return;
              setLive((prev) =>
                prev ? { ...prev, content: prev.content + chunk } : prev,
              );
            }, 60);
          },
        },
        controller.signal,
      );
      // Universal route interceptor: any path the proxy did not pre-sign is
      // signed here before the cards are built. Failures only cost the extra
      // cards, never the reply.
      const pending = scanMediaPaths(result.reply).filter(
        (path) => !result.artifacts.some((artifact) => artifact.path === path),
      );
      let artifacts = result.artifacts;
      if (pending.length > 0) {
        try {
          artifacts = [...artifacts, ...(await signHermesMedia(pending))];
        } catch {
          artifacts = result.artifacts;
        }
      }
      const collected = collectArtifacts(result.reply, artifacts);
      const split = splitQuestion(collected.text);
      setMessages((prev) => [
        ...prev,
        {
          id: bubbleId(),
          role: "assistant",
          content: split.text,
          artifacts: collected.artifacts,
          warnings: result.warnings,
          thoughts: thoughtsRef.current,
          question: split.question,
          answered: null,
        },
      ]);
      clearSentAttachments(sentIds);
      setNotice(null);
    } catch (error) {
      // A user-requested "Reintentar" aborts the old request on purpose.
      if (error instanceof Error && error.name === "AbortError") return;
      const code = error instanceof HermesError ? error.code : "network";
      if (code === "session_expired") router.replace("/login/");
      setMessages((prev) => [
        ...prev,
        {
          id: bubbleId(),
          role: "error",
          code,
          retryContent: content,
          retryFiles: files,
          retryIds: [...sentIds],
        },
      ]);
    } finally {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingDeltaRef.current = "";
      if (abortRef.current === controller) {
        abortRef.current = null;
        setSending(false);
        setLive(null);
      }
    }
  }

  /** Push a user bubble and forward the turn (shared by text, retry, answers). */
  function sendTurn(content: string, files: File[], sentIds: readonly string[]) {
    const pending = sentIds.length > 0 ? attachmentsRef.current : [];
    setMessages((prev) => [
      ...prev,
      {
        id: bubbleId(),
        role: "user",
        content,
        attachments: pending.map<SentAttachment>((item) => ({
          name: item.file.name,
          size: item.file.size,
          kind: item.kind,
        })),
      },
    ]);
    void request(content, files, sentIds);
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

  /** The banner's "Seguir esperando": keep the stream, stop nagging. */
  function keepWaiting() {
    setLive((prev) => (prev ? { ...prev, waitingAgain: true } : prev));
  }

  /** The banner's "Reintentar": drop the live turn and ask again. */
  function retryLive() {
    const { content, files, ids } = retryTurnRef.current;
    abortRef.current?.abort();
    setLive(null);
    setSending(false);
    void request(content, files, ids);
  }

  function submit() {
    const content = input.trim();
    const pending = attachmentsRef.current;
    if ((!content && pending.length === 0) || sending || !sessionId) return;
    setInput("");
    sendTurn(
      content,
      pending.map((item) => item.file),
      pending.map((item) => item.id),
    );
    inputRef.current?.focus();
  }

  function retry(message: Extract<Bubble, { role: "error" }>) {
    if (sending) return;
    setMessages((prev) => prev.filter((bubble) => bubble.id !== message.id));
    inputRef.current?.focus();
    void request(message.retryContent, message.retryFiles, message.retryIds);
  }

  function startNewConversation() {
    if (sending) return;
    const id = newSessionId();
    saveSessionId(id);
    setSessionId(id);
    setMessages([]);
    setInput("");
    clearAttachments();
    setNotice(null);
    inputRef.current?.focus();
  }

  const canSend = !sending && Boolean(sessionId) && (input.trim().length > 0 || attachments.length > 0);

  return (
    <section
      data-testid="hermes-dropzone"
      onDragOver={(event) => {
        if (sending) return;
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
        if (sending) return;
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
          disabled={sending}
          className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-300 transition-colors hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("hermes.newConversation")}
        </button>
      </header>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t("hermes.logLabel")}
        data-testid="hermes-log"
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-6"
      >
        {messages.length === 0 && !sending ? (
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
                <p className="leading-relaxed">{t(errorKey(message.code))}</p>
                {message.code !== "too_long" &&
                message.code !== "too_large" &&
                message.code !== "too_many_attachments" &&
                message.code !== "session_expired" ? (
                  <button
                    type="button"
                    onClick={() => retry(message)}
                    disabled={sending}
                    className="mt-2 rounded-md border border-rose-400/40 px-2.5 py-1 text-xs font-semibold text-rose-100 transition-colors hover:bg-rose-500/20 disabled:opacity-50"
                  >
                    {t("hermes.retry")}
                  </button>
                ) : null}
              </div>
            );
          }
          const isUser = message.role === "user";
          return (
            <div
              key={message.id}
              data-role={message.role}
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
                        className={`flex w-full min-w-0 flex-wrap gap-1.5 ${message.content ? "mt-2" : ""}`}
                      >
                        {message.attachments.map((item, index) => (
                          <li
                            key={`${message.id}-attachment-${index}`}
                            className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md bg-deck/60 px-2 py-1 text-[11px] text-slate-200"
                          >
                            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5 text-sky-300">
                              <path d="M7.5 11.5l4-4a2.5 2.5 0 013.5 3.5l-5 5a4 4 0 01-5.5-5.5l5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                            <span className="max-w-[10rem] truncate" title={item.name}>
                              {item.name}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : (
                  <>
                    <ThoughtAccordion entries={message.thoughts} />
                    <div data-testid="hermes-markdown">
                      <HermesMarkdown>{message.content}</HermesMarkdown>
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
                    {message.artifacts.length > 0 ? (
                      <div className="mt-3 grid gap-2">
                        {message.artifacts.map((artifact) => (
                          <ArtifactCard key={artifact.id} artifact={artifact} />
                        ))}
                      </div>
                    ) : null}
                    {message.question ? (
                      <InteractiveQuestionCard
                        question={message.question}
                        answered={message.answered}
                        disabled={sending}
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
                <HermesMarkdown>{live.content}</HermesMarkdown>
              </div>
            </div>
          </div>
        ) : live && live.thoughts.length > 0 ? (
          // Nothing rendered yet: the thought header floats above the status
          // line instead of drawing an empty bubble around itself.
          <div data-role="assistant" data-streaming="true" className="px-1">
            <p className="sr-only">{t("hermes.assistant")}</p>
            <ThoughtAccordion entries={live.thoughts} streaming={!live.firstDelta} />
          </div>
        ) : null}

        {live && !live.firstDelta ? (
          <div role="status" className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span aria-hidden="true" className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400 [animation-delay:-0.2s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400 [animation-delay:-0.1s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400" />
            </span>
            <span>{t("hermes.working")}</span>
            {/* Decorative: the status text is announced once, not every tick. */}
            <span
              aria-hidden="true"
              data-testid="hermes-elapsed"
              className="font-mono tabular-nums text-sky-300"
            >
              ⏱️ {formatElapsed(elapsed)}
            </span>
          </div>
        ) : null}

        {live && !live.firstDelta && elapsed * 1000 >= live.timeoutMs && !live.waitingAgain ? (
          <div
            role="alert"
            data-testid="hermes-time-limit"
            className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200"
          >
            <p className="leading-relaxed">{t("hermes.timeLimit")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={keepWaiting}
                className="rounded-md border border-amber-400/40 px-2.5 py-1 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-500/20"
              >
                {t("hermes.keepWaiting")}
              </button>
              <button
                type="button"
                onClick={retryLive}
                className="rounded-md border border-rose-400/40 px-2.5 py-1 text-xs font-semibold text-rose-100 transition-colors hover:bg-rose-500/20"
              >
                {t("hermes.retry")}
              </button>
            </div>
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

        <AttachmentBar items={attachments} onRemove={removeAttachment} disabled={sending} />

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!sessionId || sending}
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
            disabled={!sessionId || sending}
            onRecorded={(file) => addFiles([file])}
          />

          <textarea
            id="hermes-input"
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
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
