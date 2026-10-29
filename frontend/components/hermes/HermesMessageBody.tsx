"use client";

import { memo } from "react";
import HermesMarkdown from "@/components/hermes/HermesMarkdown";
import { splitInlineImages } from "@/lib/hermes/inline-images";
import { t } from "@/lib/i18n";

/**
 * One reply body: prose through the Markdown renderer and every validated
 * `data:image/...` payload as a real inline picture.
 *
 * The split runs over the accumulated text (the caller passes the whole message
 * so far), never over an SSE delta, so a payload is only drawn once it is
 * complete. `final` says whether the message stopped growing: while streaming,
 * a trailing payload without its closing parenthesis stays hidden behind a
 * discreet placeholder instead of printing base64.
 */
function HermesMessageBody({ content, final }: { content: string; final: boolean }) {
  const segments = splitInlineImages(content, { final });
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return segment.value.length > 0 ? (
            <HermesMarkdown key={`text-${index}`}>{segment.value}</HermesMarkdown>
          ) : null;
        }
        if (segment.type === "image") {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={segment.id}
              src={segment.src}
              alt={segment.alt}
              loading="lazy"
              referrerPolicy="no-referrer"
              data-testid="hermes-inline-image"
              className="my-2 h-auto max-w-full rounded-lg shadow-md"
            />
          );
        }
        const key = segment.type === "pending" ? "hermes.imagePending" : "hermes.imageTooLarge";
        return (
          <p
            key={segment.id}
            data-testid={`hermes-${segment.type}-image`}
            className="my-2 rounded-md border border-hair bg-deck/60 px-2.5 py-1.5 text-[11px] text-muted"
          >
            {t(key)}
          </p>
        );
      })}
    </>
  );
}

/** Memoized: a streaming reply re-renders every 60 ms, the transcript must not. */
export default memo(HermesMessageBody);
