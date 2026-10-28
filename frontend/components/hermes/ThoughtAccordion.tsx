"use client";

import { useState } from "react";
import type { HermesToolEvent } from "@/lib/api/hermes";
import { t } from "@/lib/i18n";

export interface ThoughtEntry {
  kind: "thinking" | "tool";
  text?: string;
  tool?: HermesToolEvent;
}

/**
 * Reasoning and tool calls collapse under one discreet header. It stays
 * collapsed by default so the answer owns the bubble, and shows the running
 * tool in the header while one is executing.
 */
export default function ThoughtAccordion({
  entries,
  streaming = false,
}: {
  entries: ThoughtEntry[];
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;

  const running = [...entries]
    .reverse()
    .find((entry) => entry.kind === "tool" && entry.tool?.status !== "completed");
  const label = running
    ? t("hermes.callingTool", { tool: running.tool?.tool ?? "" })
    : t("hermes.thought");

  return (
    <div data-testid="hermes-thought" className="mb-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-slate-200"
      >
        <span
          aria-hidden="true"
          className={`inline-block transition-transform ${open ? "rotate-90" : ""} ${
            streaming && running ? "text-sky-400" : ""
          }`}
        >
          ▸
        </span>
        <span className={streaming && running ? "animate-pulse" : ""}>{label}</span>
      </button>
      {open ? (
        <div className="mt-1 space-y-2 rounded-lg border border-hair bg-deck/50 px-3 py-2">
          {entries.map((entry, index) =>
            entry.kind === "thinking" ? (
              <pre
                key={`thought-${index}`}
                className="whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-slate-300"
              >
                {entry.text}
              </pre>
            ) : (
              <p
                key={`tool-${index}`}
                className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400"
              >
                <span aria-hidden="true">{entry.tool?.emoji ?? "🔧"}</span>
                <span className="min-w-0 break-words">
                  <span className="font-mono text-slate-300">{entry.tool?.tool}</span>
                  {entry.tool?.label ? (
                    <span className="text-muted"> · {entry.tool.label}</span>
                  ) : null}
                  {entry.tool?.status === "completed" ? (
                    <span className="text-emerald-400/80"> · {t("hermes.toolDone")}</span>
                  ) : (
                    <span className="text-sky-400/80"> · {t("hermes.toolRunning")}</span>
                  )}
                </span>
              </p>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
