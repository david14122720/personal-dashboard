import { describe, expect, it } from "vitest";

import {
  maxBytesFor,
  MAX_ATTACHMENTS,
  attachmentReference,
  classifyFile,
  composeTurnText,
  formatBytes,
  makeAttachment,
  planAttachments,
  travelsInline,
  voiceFileName,
  type StoredUpload,
} from "./attachments";

const MB = 1024 * 1024;

function file(name: string, size: number, type = ""): File {
  return new File([new Uint8Array(size)], name, { type });
}

/** A File that reports `size` without allocating megabytes in the test heap. */
function sizedFile(name: string, size: number, type = ""): File {
  const created = file(name, 1, type);
  Object.defineProperty(created, "size", { value: size });
  return created;
}

function uploaded(overrides: Partial<StoredUpload> = {}): StoredUpload {
  const id = "3f0f0a4e-6a4b-4c3d-8f2e-0b1c2d3e4f5a";
  return {
    id,
    name: "informe.docx",
    mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 2048,
    url: `/api/uploads/${id}`,
    local_path: `/opt/data/uploads/${id}.docx`,
    ...overrides,
  };
}

describe("hermes attachments — S3 allowlist and ceilings", () => {
  it("accepts each allowed family exactly at its ceiling", () => {
    const plan = planAttachments([], [
      sizedFile("foto.png", 5 * MB, "image/png"),
      sizedFile("clip.mp4", 100 * MB, "video/mp4"),
      sizedFile("voz.mp3", 20 * MB, "audio/mpeg"),
      sizedFile("informe.docx", 50 * MB, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ]);

    expect(plan.rejections).toEqual([]);
    expect(plan.accepted.map((item) => [item.file.name, item.kind])).toEqual([
      ["foto.png", "image"],
      ["clip.mp4", "video"],
      ["voz.mp3", "audio"],
      ["informe.docx", "document"],
    ]);
  });

  it("rejects foo.exe as a type and keeps the valid files of the same batch", () => {
    const plan = planAttachments([], [
      file("foo.exe", 10, "application/x-msdownload"),
      file("informe.pdf", 10, "application/pdf"),
    ]);

    expect(plan.accepted.map((item) => item.file.name)).toEqual(["informe.pdf"]);
    expect(plan.rejections).toEqual([
      { code: "type", filename: "foo.exe", detail: expect.stringContaining("pdf") },
    ]);
  });

  it("rejects a 6 MB png as a size violation and keeps the valid files of the same batch", () => {
    const plan = planAttachments([], [
      sizedFile("captura.png", 6 * MB, "image/png"),
      file("nota.txt", 10, "text/plain"),
    ]);

    expect(plan.accepted.map((item) => item.file.name)).toEqual(["nota.txt"]);
    expect(plan.rejections).toEqual([
      { code: "size", filename: "captura.png", detail: "5 MB" },
    ]);
  });

  it("rejects the 21st file as a count overflow and keeps the valid sibling", () => {
    const existing = Array.from({ length: MAX_ATTACHMENTS - 1 }, (_, index) =>
      makeAttachment(file(`f${index}.txt`, 1), "document"),
    );
    const plan = planAttachments(existing, [file("bueno.txt", 1), file("extra.txt", 1)]);

    expect(plan.accepted.map((item) => item.file.name)).toEqual(["bueno.txt"]);
    expect(plan.rejections).toEqual([
      { code: "count", filename: "extra.txt", detail: String(MAX_ATTACHMENTS) },
    ]);
  });

  it("classifies the four families by extension, never by the declared mime", () => {
    expect(classifyFile(file("foto.png", 4, "application/octet-stream"))).toBe("image");
    expect(classifyFile(file("clip.mov", 4, ""))).toBe("video");
    expect(classifyFile(file("nota.ogg", 4, "audio/ogg"))).toBe("audio");
    expect(classifyFile(file("planilla.xlsx", 4))).toBe("document");
    expect(classifyFile(file("backup.zip", 4))).toBe("document");
    expect(classifyFile(file("foo.exe", 4))).toBeNull();
    expect(classifyFile(file("sin-extension", 4))).toBeNull();
  });

  // JD-B-004: `webm` and `mp4` are also audio containers. The microphone
  // records `audio/webm`; classifying by extension alone turned a voice note
  // into a 100 MB video and a video bubble.
  it("keeps a recorded voice note in the audio family", () => {
    expect(classifyFile(new File(["x"], "nota.webm", { type: "audio/webm" }))).toBe("audio");
    expect(classifyFile(new File(["x"], "nota.mp4", { type: "audio/mp4" }))).toBe("audio");
    expect(maxBytesFor(new File(["x"], "nota.webm", { type: "audio/webm" }))).toBe(20 * 1024 * 1024);
    // The same containers declared as video keep the video ceiling.
    expect(classifyFile(new File(["x"], "clip.webm", { type: "video/webm" }))).toBe("video");
    expect(maxBytesFor(new File(["x"], "clip.webm", { type: "video/webm" }))).toBe(100 * 1024 * 1024);
  });

  it("keeps only images on the inline path (S4)", () => {
    expect(travelsInline("image")).toBe(true);
    expect(travelsInline("video")).toBe(false);
    expect(travelsInline("audio")).toBe(false);
    expect(travelsInline("document")).toBe(false);
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

describe("attachmentReference — the S4 line Hermes reads", () => {
  it("writes the exact structured reference for a stored docx", () => {
    const upload = uploaded();
    expect(attachmentReference(upload)).toBe(
      "[archivo adjunto: informe.docx (application/vnd.openxmlformats-officedocument.wordprocessingml.document, 2 KB), ruta: /opt/data/uploads/3f0f0a4e-6a4b-4c3d-8f2e-0b1c2d3e4f5a.docx]",
    );
  });
});

describe("composeTurnText", () => {
  const first = uploaded({ name: "uno.pdf", local_path: "/opt/data/uploads/a.pdf", size: 10 });
  const second = uploaded({ name: "dos.docx", local_path: "/opt/data/uploads/b.docx", size: 20 });

  it("leaves the text untouched when there is nothing stored", () => {
    expect(composeTurnText("solo texto", [])).toBe("solo texto");
    expect(composeTurnText("", [])).toBe("");
  });

  it("appends exactly one reference for one upload", () => {
    expect(composeTurnText("mirá esto", [first])).toBe(
      `mirá esto\n\n${attachmentReference(first)}`,
    );
  });

  it("appends one reference per upload, in upload order", () => {
    expect(composeTurnText("mirá esto", [first, second])).toBe(
      ["mirá esto", attachmentReference(first), attachmentReference(second)].join("\n\n"),
    );
  });

  it("starts with the reference when the user wrote no text", () => {
    expect(composeTurnText("", [first])).toBe(attachmentReference(first));
  });
});
