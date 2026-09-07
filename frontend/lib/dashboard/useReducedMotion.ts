"use client";

import { useState } from "react";

/**
 * Reduced-motion flag for charts and count-ups. Lazily initialized so the
 * first paint already matches the OS setting (no animation flash), then
 * kept in sync if the user changes the preference mid-session.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  return reduced;
}
