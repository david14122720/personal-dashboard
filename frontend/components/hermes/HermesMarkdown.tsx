"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

/**
 * Hermes answers are Markdown from a remote agent: render them as React
 * elements only. `react-markdown` never injects raw HTML, and `rehype-sanitize`
 * strips anything outside the default safe schema (scripts, event handlers,
 * unsafe protocols) as a second barrier.
 */
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
  code: ({ node: _node, ...props }) => (
    <code
      {...props}
      className="rounded bg-deck px-1.5 py-0.5 font-mono text-[0.85em] text-sky-300"
    />
  ),
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
  // Remote images would let agent output beacon to third parties (IP/tracking).
  img: () => null,
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
