"use client";

import { useState } from "react";
import type { HermesQuestion } from "@/lib/hermes/questions";
import { t } from "@/lib/i18n";

const PER_PAGE = 3;

/**
 * Claude-style decision card: options are buttons (choosing one answers
 * immediately), "Otra cosa" reveals a free-text field, and "Omitir" closes the
 * question without inventing an answer.
 */
export default function InteractiveQuestionCard({
  question,
  onAnswer,
  answered,
  disabled = false,
}: {
  question: HermesQuestion;
  onAnswer: (answer: string) => void;
  answered?: string | null;
  disabled?: boolean;
}) {
  const [page, setPage] = useState(0);
  const [other, setOther] = useState(false);
  const [draft, setDraft] = useState("");

  const pages = Math.max(1, Math.ceil(question.options.length / PER_PAGE));
  const current = Math.min(page, pages - 1);
  const options = question.options.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE);
  const locked = disabled || Boolean(answered);

  if (answered) {
    return (
      <div
        data-testid="hermes-question"
        className="mt-3 rounded-xl border border-hair bg-deck/40 px-3 py-2 text-[11px] text-muted"
      >
        {t("hermes.answered", { answer: answered })}
      </div>
    );
  }

  return (
    <div
      data-testid="hermes-question"
      className="mt-3 rounded-xl border border-hair bg-deck/40 p-3"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-xs font-semibold leading-relaxed text-instrument">{question.prompt}</p>
        {pages > 1 ? (
          <div className="flex shrink-0 items-center gap-1 text-[11px] text-muted">
            <button
              type="button"
              aria-label={t("hermes.previousPage")}
              disabled={locked || current === 0}
              onClick={() => setPage(current - 1)}
              className="rounded px-1 disabled:opacity-30"
            >
              ‹
            </button>
            <span aria-live="polite">{t("hermes.page", { current: current + 1, total: pages })}</span>
            <button
              type="button"
              aria-label={t("hermes.nextPage")}
              disabled={locked || current >= pages - 1}
              onClick={() => setPage(current + 1)}
              className="rounded px-1 disabled:opacity-30"
            >
              ›
            </button>
          </div>
        ) : null}
      </div>

      <ul className="space-y-1.5">
        {options.map((option) => (
          <li key={option.title}>
            <button
              type="button"
              disabled={locked}
              onClick={() => onAnswer(option.value)}
              className="w-full rounded-lg border border-hair bg-panel px-3 py-2 text-left transition-colors hover:border-sky-500/40 hover:bg-sky-500/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="block text-xs font-semibold text-instrument">{option.title}</span>
              {option.description ? (
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                  {option.description}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {other ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return;
                event.preventDefault();
                const answer = draft.trim();
                if (answer) onAnswer(answer);
              }}
              placeholder={t("hermes.otherPlaceholder")}
              aria-label={t("hermes.other")}
              disabled={locked}
              autoFocus
              className="min-w-0 flex-1 rounded-lg border border-hair bg-deck px-2.5 py-1.5 text-xs text-instrument placeholder:text-muted focus-visible:outline-2 focus-visible:outline-signal"
            />
            <button
              type="button"
              aria-label={t("hermes.sendAnswer")}
              disabled={locked || draft.trim().length === 0}
              onClick={() => {
                const answer = draft.trim();
                if (answer) onAnswer(answer);
              }}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-signal text-sm font-bold text-deck disabled:opacity-40"
            >
              ↑
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={locked}
            onClick={() => setOther(true)}
            className="rounded-lg border border-hair px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-slate-200 disabled:opacity-50"
          >
            {t("hermes.other")}
          </button>
        )}
        <button
          type="button"
          disabled={locked}
          onClick={() => onAnswer(t("hermes.skip"))}
          className="rounded-lg px-2 py-1 text-[11px] text-muted transition-colors hover:text-slate-200 disabled:opacity-50"
        >
          {t("hermes.skip")}
        </button>
      </div>
    </div>
  );
}
