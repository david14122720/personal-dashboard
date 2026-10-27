import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  classifyFile,
  formatBytes,
  makeAttachment,
  planAttachments,
  voiceFileName,
} from "./attachments";

function file(name: string, size: number, type = ""): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("hermes attachments", () => {
  it("classifies by mime first and by extension as fallback", () => {
    expect(classifyFile(file("foto.png", 4, "image/png"))).toBe("image");
    expect(classifyFile(file("nota.webm", 4, "audio/webm"))).toBe("audio");
    expect(classifyFile(file("notas.md", 4, "text/markdown"))).toBe("text");
    expect(classifyFile(file("datos.json", 4))).toBe("text");
    expect(classifyFile(file("codigo.rs", 4))).toBe("text");
    expect(classifyFile(file("backup.zip", 4))).toBe("other");
    expect(classifyFile(file("sin-extension", 4))).toBe("other");
  });

  it("accepts a mixed batch and keeps the order", () => {
    const plan = planAttachments([], [
      file("a.png", 10, "image/png"),
      file("b.pdf", 20, "application/pdf"),
      file("c.webm", 30, "audio/webm"),
    ]);
    expect(plan.rejection).toBeNull();
    expect(plan.accepted.map((item) => item.file.name)).toEqual(["a.png", "b.pdf", "c.webm"]);
  });

  it("rejects the first file that breaks the per-file limit", () => {
    const plan = planAttachments([], [file("ok.txt", 10), file("grande.zip", MAX_FILE_BYTES + 1)]);
    expect(plan.accepted.map((item) => item.file.name)).toEqual(["ok.txt"]);
    expect(plan.rejection).toEqual({ code: "file_too_large", filename: "grande.zip" });
  });

  it("rejects the 21st file", () => {
    const existing = Array.from({ length: MAX_ATTACHMENTS }, (_, index) =>
      makeAttachment(file(`f${index}.txt`, 1)),
    );
    const plan = planAttachments(existing, [file("extra.txt", 1)]);
    expect(plan.accepted).toHaveLength(0);
    expect(plan.rejection).toEqual({ code: "too_many", filename: "extra.txt" });
  });

  it("rejects a batch that exceeds the total budget", () => {
    const existing = [makeAttachment(file("previo.bin", MAX_TOTAL_BYTES - 5))];
    const plan = planAttachments(existing, [file("resto.bin", 10)]);
    expect(plan.rejection).toEqual({ code: "total_too_large", filename: "resto.bin" });
  });

  it("formats sizes for the chip label", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
  });

  it("names voice notes after their container, never a path", () => {
    expect(voiceFileName("audio/webm", Date.UTC(2026, 9, 27, 12, 0, 0))).toBe(
      "nota-de-voz-2026-10-27T12-00-00-000Z.webm",
    );
    expect(voiceFileName("audio/mp4")).toMatch(/\.mp4$/);
    expect(voiceFileName("audio/ogg")).toMatch(/\.ogg$/);
  });
});
