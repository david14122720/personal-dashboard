"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import HermesMarkdown from "@/components/hermes/HermesMarkdown";
import { HermesError, type HermesErrorCode, sendHermesMessage } from "@/lib/api/hermes";
import { loadOrCreateSessionId, newSessionId, saveSessionId } from "@/lib/hermes/session";
import { t } from "@/lib/i18n";

type Bubble =
  | { id: number; role: "user" | "assistant"; content: string }
  | { id: number; role: "error"; code: HermesErrorCode; retryContent: string };

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

export default function HermesChat() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Recover or mint the UUID after mount: the static export prerenders this
  // page, and localStorage does not exist on the server.
  useEffect(() => {
    setSessionId(loadOrCreateSessionId());
  }, []);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, sending]);

  async function request(content: string) {
    if (!sessionId) return;
    setSending(true);
    try {
      const reply = await sendHermesMessage(sessionId, content);
      setMessages((prev) => [...prev, { id: bubbleId(), role: "assistant", content: reply }]);
    } catch (error) {
      const code = error instanceof HermesError ? error.code : "network";
      if (code === "session_expired") router.replace("/login/");
      setMessages((prev) => [
        ...prev,
        { id: bubbleId(), role: "error", code, retryContent: content },
      ]);
    } finally {
      setSending(false);
    }
  }

  function submit() {
    const content = input.trim();
    if (!content || sending || !sessionId) return;
    setMessages((prev) => [...prev, { id: bubbleId(), role: "user", content }]);
    setInput("");
    void request(content);
    inputRef.current?.focus();
  }

  function retry(message: Extract<Bubble, { role: "error" }>) {
    if (sending) return;
    setMessages((prev) => prev.filter((bubble) => bubble.id !== message.id));
    inputRef.current?.focus();
    void request(message.retryContent);
  }

  function startNewConversation() {
    if (sending) return;
    const id = newSessionId();
    saveSessionId(id);
    setSessionId(id);
    setMessages([]);
    setInput("");
    inputRef.current?.focus();
  }

  return (
    <section className="flex h-[calc(100dvh-16rem)] min-h-[24rem] flex-col overflow-hidden rounded-xl border border-hair bg-panel md:h-[calc(100dvh-7.5rem)]">
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
        className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6"
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
                {message.code !== "too_long" && message.code !== "session_expired" ? (
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
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                  isUser
                    ? "rounded-br-md bg-sky-500/15 text-instrument"
                    : "rounded-bl-md border border-hair bg-card text-slate-200"
                }`}
              >
                <p className="sr-only">{isUser ? t("hermes.you") : t("hermes.assistant")}</p>
                {isUser ? (
                  <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                ) : (
                  <div data-testid="hermes-markdown">
                    <HermesMarkdown>{message.content}</HermesMarkdown>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {sending ? (
          <div role="status" className="flex items-center gap-2 text-xs text-muted">
            <span aria-hidden="true" className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400 [animation-delay:-0.2s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400 [animation-delay:-0.1s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400" />
            </span>
            {t("hermes.working")}
          </div>
        ) : null}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="border-t border-hair px-4 py-3 sm:px-6"
      >
        <label htmlFor="hermes-input" className="sr-only">
          {t("hermes.placeholder")}
        </label>
        <div className="flex items-end gap-2">
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
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-lg border border-hair bg-deck px-3 py-2.5 text-sm text-instrument placeholder:text-muted focus-visible:outline-2 focus-visible:outline-signal disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending || !sessionId}
            className="min-h-[44px] shrink-0 rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-deck transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("hermes.send")}
          </button>
        </div>
        <p className="mt-1.5 hidden text-[10px] text-muted sm:block">{t("hermes.hint")}</p>
      </form>
    </section>
  );
}
