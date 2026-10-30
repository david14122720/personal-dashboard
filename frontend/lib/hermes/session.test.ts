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

  it("round-trips the stored upload metadata of an attachment (S5)", () => {
    saveMessages([
      {
        id: 1,
        role: "user",
        content: "",
        attachments: [
          {
            name: "foto.png",
            size: 12,
            kind: "image",
            url: "/api/uploads/up-1",
            mime_type: "image/png",
            local_path: "/opt/data/uploads/up-1.png",
          },
        ],
        queued: false,
      },
    ]);

    expect(loadMessages()[0]).toMatchObject({
      role: "user",
      attachments: [
        {
          name: "foto.png",
          size: 12,
          kind: "image",
          url: "/api/uploads/up-1",
          mime_type: "image/png",
          local_path: "/opt/data/uploads/up-1.png",
        },
      ],
    });
  });

  it("restores a bubble written before this change (legacy artifacts, no attachment url)", () => {
    // A transcript saved by the previous build: assistant bubbles carried an
    // `artifacts[]` array and user attachments had no stored url. Both must
    // load as plain text instead of being dropped or crashing the chat.
    localStorage.setItem(
      HERMES_MESSAGES_KEY,
      JSON.stringify([
        {
          id: 1,
          role: "user",
          content: "mirá esto",
          queued: false,
          attachments: [{ name: "viejo.pdf", size: 1024, kind: "document" }],
        },
        {
          id: 2,
          role: "assistant",
          content: "listo",
          artifacts: [
            { id: "a1", name: "grafico.png", url: "/files/tmp/grafico.png", kind: "image" },
          ],
          warnings: [],
          thoughts: [],
          question: null,
          answered: null,
        },
      ]),
    );

    const loaded = loadMessages();
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toMatchObject({
      role: "user",
      content: "mirá esto",
      attachments: [{ name: "viejo.pdf", size: 1024, kind: "document" }],
    });
    expect(loaded[1]).toMatchObject({ role: "assistant", content: "listo" });
    // Output rendering is gone (S2): the legacy field is simply not kept.
    expect(JSON.stringify(loaded)).not.toContain("artifacts");
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
