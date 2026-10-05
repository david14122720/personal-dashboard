"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

export interface ContainerWidth<T extends HTMLElement> {
  /** Attach to the element whose inner width should bound the chart. */
  ref: RefObject<T | null>;
  /** Measured inner width, or `fallback` when it cannot be measured. */
  width: number;
}

/**
 * Measures the inner width of the observed element and re-measures on resize,
 * so a chart scales to its container instead of scrolling inside it.
 *
 * `fallback` covers every environment without layout — server render, jsdom,
 * a collapsed panel, a detached node: whenever the measurement is unavailable
 * or zero the chart keeps its previous fixed width. No `window` access during
 * render, one `ResizeObserver` per mounted chart, disconnected on unmount.
 */
export function useContainerWidth<T extends HTMLElement = HTMLDivElement>(
  fallback: number,
): ContainerWidth<T> {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }
    const measure = () => {
      const box = node.getBoundingClientRect().width;
      // `clientWidth` also excludes a scrollbar; the rect covers fractional
      // layout, and flooring keeps a sub-pixel from pushing the panel into
      // horizontal overflow.
      const available = Math.floor(Math.min(box, node.clientWidth || box));
      setWidth(available > 0 ? available : fallback);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [fallback]);

  return { ref, width };
}
