"use client";

import { useEffect } from "react";

/**
 * Locks the page behind a modal for as long as the modal is open.
 *
 * While `active` is true `document.body` gets `overflow: hidden`; the inline
 * value found on mount is restored on cleanup, so closing the dialog — or
 * unmounting it — gives the page back exactly the scroll state it had
 * (usually the empty string). Inactive renders are a no-op.
 *
 * Safe under React 19 StrictMode's mount/unmount/mount cycle: every effect
 * run captures the value it finds and restores it, so the second run captures
 * the restored original instead of capturing its own lock. No `document`
 * access during render, so a server render stays inert and jsdom behaves like
 * a browser.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const body = document.body;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previous;
    };
  }, [active]);
}
