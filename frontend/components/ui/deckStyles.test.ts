import { describe, expect, it } from "vitest";
import { deck } from "./deckStyles";

const recipes = Object.entries(deck);
const SHADOW_SIZE = /\bshadow-(?:2xs|xs|sm|md|lg|xl|2xl|inner|none)\b/;

describe("deckStyles", () => {
  it("exports every recipe as a non-empty class string", () => {
    expect(recipes.length).toBeGreaterThan(0);
    for (const [name, value] of recipes) {
      expect(typeof value, name).toBe("string");
      expect(value.trim().length, name).toBeGreaterThan(0);
    }
  });

  it("keeps every recipe distinct", () => {
    const seen = new Map<string, string>();
    for (const [name, value] of recipes) {
      expect(seen.has(value), `${name} duplicates ${seen.get(value)}`).toBe(false);
      seen.set(value, name);
    }
  });

  it("never reintroduces the invalid py-0.2 from the prototypes", () => {
    for (const [name, value] of recipes) {
      expect(value.split(/\s+/), name).not.toContain("py-0.2");
    }
    expect(deck.notificationCountPill).toContain("py-[0.1rem]");
  });

  it("pairs every shadow-sky-500/30 with a shadow size class", () => {
    for (const [name, value] of recipes) {
      if (value.includes("shadow-sky-500/30")) {
        expect(SHADOW_SIZE.test(value), `${name}: ${value}`).toBe(true);
      }
    }
  });
});
