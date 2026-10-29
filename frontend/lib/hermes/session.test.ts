import { afterEach, describe, expect, it } from "vitest";

import {
  HERMES_MAX_STORED_BUBBLES,
  HERMES_MAX_STORED_BYTES,
  HERMES_MESSAGES_KEY,
  clearMessages,
  loadMessages,
  saveMessages,
  type StoredBubble,
} from "./session";

function userBubble(id: number, content: string): StoredBubble {
  return { id, role: "user", content, attachments: [], queued: false };
}

function assistantBubble(id: number, content: string): StoredBubble {
  return {
    id,
    role: "assistant",
    content,
    artifacts: [],
    warnings: [],
    thoughts: [],
    question: null,
    answered: null,
  };
}

afterEach(() => localStorage.clear());

describe("message transcript storage", () => {
  it("round-trips settled bubbles of every role", () => {
    saveMessages([
      userBubble(1, "hola"),
      assistantBubble(2, "respuesta"),
      { id: 3, role: "error", code: "upstream", message: null, retryContent: "hola", retryIds: [] },
    ]);
    expect(loadMessages()).toHaveLength(3);
  });

  it("returns an empty transcript for missing or corrupt payloads", () => {
    expect(loadMessages()).toEqual([]);
    localStorage.setItem(HERMES_MESSAGES_KEY, "not-json{{{");
    expect(loadMessages()).toEqual([]);
    localStorage.setItem(HERMES_MESSAGES_KEY, JSON.stringify({ role: "user" }));
    expect(loadMessages()).toEqual([]);
  });

  it("drops invalid bubbles silently and keeps the valid ones", () => {
    localStorage.setItem(
      HERMES_MESSAGES_KEY,
      JSON.stringify([
        userBubble(1, "válido"),
        { id: 2, role: "user" },
        { id: 3, role: "nonsense", content: "x" },
        42,
        null,
        assistantBubble(4, "también válido"),
      ]),
    );
    expect(loadMessages().map((bubble) => bubble.id)).toEqual([1, 4]);
  });

  it("keeps at most 40 bubbles, newest last", () => {
    saveMessages(
      Array.from({ length: HERMES_MAX_STORED_BUBBLES + 10 }, (_, index) =>
        userBubble(index + 1, `m${index + 1}`),
      ),
    );
    const loaded = loadMessages();
    expect(loaded).toHaveLength(HERMES_MAX_STORED_BUBBLES);
    expect(loaded[0].id).toBe(11);
    expect(loaded[loaded.length - 1].id).toBe(HERMES_MAX_STORED_BUBBLES + 10);
  });

  it("drops the oldest bubbles until the JSON is under 200 KB", () => {
    const big = "x".repeat(90_000);
    saveMessages([userBubble(1, big), userBubble(2, big), userBubble(3, big)]);
    const loaded = loadMessages();
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.length).toBeLessThan(3);
    expect(loaded[loaded.length - 1].id).toBe(3);
    const bytes = new TextEncoder().encode(localStorage.getItem(HERMES_MESSAGES_KEY)!).length;
    expect(bytes).toBeLessThanOrEqual(HERMES_MAX_STORED_BYTES);
  });

  it("never throws when storage is unavailable", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(() => saveMessages([userBubble(1, "hola")])).not.toThrow();
      expect(() => clearMessages()).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("clears the stored transcript", () => {
    saveMessages([userBubble(1, "hola")]);
    expect(loadMessages()).toHaveLength(1);
    clearMessages();
    expect(loadMessages()).toEqual([]);
  });
});
