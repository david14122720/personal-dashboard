"use client";

import { memo } from "react";
import HermesMarkdown from "@/components/hermes/HermesMarkdown";

/**
 * One reply body: clean sanitized Markdown, nothing else.
 *
 * Owner spec S2 removed the output-file pipeline, so this component no longer
 * splits `data:` payloads, no longer draws pictures and no longer carding
 * server paths. A long deliverable is delivered over Telegram by Hermes, not
 * served by the web chat.
 */
function HermesMessageBody({ content }: { content: string; final: boolean }) {
  return <HermesMarkdown>{content}</HermesMarkdown>;
}

/** Memoized: a streaming reply re-renders every 60 ms, the transcript must not. */
export default memo(HermesMessageBody);
