"use client";

import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { safeImageSource } from "@/lib/hermes/inline-images";
import { highlight, normalizeLanguage, type TokenKind } from "@/lib/hermes/highlight";

/**
 * Hermes answers are Markdown from a remote agent: render them as React
 * elements only. `react-markdown` never injects raw HTML, and `rehype-sanitize`
 * strips anything outside the default safe schema (scripts, event handlers,
 * unsafe protocols) as a second barrier. Images are allowed only through
 * `safeImageSource`: a validated raster payload or the proxy's signed media
 * URL, never a remote host the model picked.
 */
const TOKEN_CLASS: Record<TokenKind, string> = {
  plain: "",
  comment: "text-slate-500 italic",
  string: "text-emerald-300",
  keyword: "text-sky-300",
  number: "text-amber-300",
  function: "text-violet-300",
  operator: "text-slate-400",
  builtin: "text-cyan-300",
  addition: "text-emerald-300",
  deletion: "text-rose-300",
  meta: "text-sky-400",
};

/**
 * One fenced block. The language comes from the fence info string; an unknown
 * language renders the code untouched instead of guessing.
 */
function CodeBlock({ language, children }: { language: string | null; children: string }) {
  if (normalizeLanguage(language) === null) return <>{children}</>;
  const tokens = highlight(children, language);
  return (
    <>
      {tokens.map((token, index) =>
        token.kind === "plain" ? (
          token.text
        ) : (
          <span key={`${index}-${token.kind}`} data-token={token.kind} className={TOKEN_CLASS[token.kind]}>
            {token.text}
          </span>
        ),
      )}
    </>
  );
}

const components: Components = {
  p: ({ node: _node, ...props }) => (
    <p className="mb-2 leading-relaxed last:mb-0" {...props} />
  ),
  strong: ({ node: _node, ...props }) => (
    <strong className="font-semibold text-instrument" {...props} />
  ),
  em: ({ node: _node, ...props }) => <em className="italic" {...props} />,
  ul: ({ node: _node, ...props }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0" {...props} />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0" {...props} />
  ),
  li: ({ node: _node, ...props }) => <li className="leading-relaxed" {...props} />,
  a: ({ node: _node, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sky-400 underline decoration-sky-500/40 underline-offset-2 hover:text-sky-300"
    />
  ),
  code: ({ node: _node, className, children, ...props }) => {
    const language = /language-([\w+-]+)/.exec(className ?? "")?.[1] ?? null;
    const raw = Array.isArray(children)
      ? children.map((child) => (typeof child === "string" ? child : "")).join("")
      : typeof children === "string"
        ? children
        : "";
    const fenced = className !== undefined && language !== null;
    return (
      <code
        {...props}
        className={[
          "rounded bg-deck px-1.5 py-0.5 font-mono text-[0.85em] text-sky-300",
          fenced ? "block bg-transparent p-0 text-inherit" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {fenced ? (
          <CodeBlock language={language}>
            {raw.replace(/\n$/, "")}
          </CodeBlock>
        ) : (
          children as ReactNode
        )}
      </code>
    );
  },
  pre: ({ node: _node, ...props }) => (
    <pre
      {...props}
      className="my-2 overflow-x-auto rounded-lg border border-hair bg-deck p-3 font-mono text-xs leading-relaxed text-slate-200 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit"
    />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote
      {...props}
      className="my-2 border-l-2 border-sky-500/40 pl-3 text-slate-300"
    />
  ),
  h1: ({ node: _node, ...props }) => (
    <h3 className="mb-2 mt-3 text-base font-semibold text-instrument first:mt-0" {...props} />
  ),
  h2: ({ node: _node, ...props }) => (
    <h3 className="mb-2 mt-3 text-sm font-semibold text-instrument first:mt-0" {...props} />
  ),
  h3: ({ node: _node, ...props }) => (
    <h4 className="mb-1.5 mt-2 text-sm font-semibold text-instrument first:mt-0" {...props} />
  ),
  hr: ({ node: _node, ...props }) => <hr className="my-3 border-hair" {...props} />,
  // A model-authored URL must never load on render: only a validated payload
  // or the proxy's own signed media URL can become an <img>.
  img: ({ src, alt }) => {
    const safe = safeImageSource(typeof src === "string" ? src : null);
    if (safe === null) {
      // Never load a model-chosen URL (remote hosts stay blocked, D-A6), but do
      // not silently delete the caption either: the alt text is prose, and React
      // renders it as an escaped text node.
      const caption = typeof alt === "string" ? alt.trim() : "";
      return caption.length > 0 ? <span className="text-muted">{caption}</span> : null;
    }
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={safe}
        alt={typeof alt === "string" ? alt : ""}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="my-2 h-auto max-w-full rounded-lg shadow-md"
      />
    );
  },
  table: ({ node: _node, ...props }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs" {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }) => (
    <th className="border border-hair px-2 py-1 text-left font-semibold" {...props} />
  ),
  td: ({ node: _node, ...props }) => (
    <td className="border border-hair px-2 py-1 align-top" {...props} />
  ),
};

function HermesMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      rehypePlugins={[rehypeSanitize]}
      components={components}
    >
      {children}
    </ReactMarkdown>
  );
}

/**
 * Memoized: while one reply streams (a state update every 60 ms) the rest of
 * the transcript must not re-parse its Markdown on every chunk.
 */
export default memo(HermesMarkdown);
