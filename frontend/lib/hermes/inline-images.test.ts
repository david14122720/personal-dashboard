import { describe, expect, it } from "vitest";
import { MAX_INLINE_IMAGE_CHARS, safeImageSource, splitInlineImages } from "./inline-images";

/** A payload long enough to clear the "documentation example" floor. */
const B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

function image(text: string, final = true) {
  return splitInlineImages(text, { final }).filter((segment) => segment.type === "image");
}

describe("inline base64 images", () => {
  it("turns a markdown image payload into one image segment", () => {
    const segments = splitInlineImages(`Antes\n![gato](\ndata:image/png;base64,${B64})\nDespués`);
    expect(segments.map((segment) => segment.type)).toEqual(["text", "image", "text"]);
    const [, picture, tail] = segments;
    if (picture.type !== "image") throw new Error("expected an image");
    expect(picture.src).toBe(`data:image/png;base64,${B64}`);
    expect(picture.alt).toBe("gato");
    if (tail.type !== "text") throw new Error("expected text");
    expect(tail.value).toContain("Después");
  });

  it("accepts every allowlisted mime and rejects svg", () => {
    for (const mime of ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]) {
      expect(image(`![x](data:${mime};base64,${B64})`)).toHaveLength(1);
    }
    expect(image(`![x](data:image/svg+xml;base64,${B64})`)).toHaveLength(0);
    expect(splitInlineImages(`![x](data:image/svg+xml;base64,${B64})`)[0].type).toBe("text");
  });

  it("keeps a literal example payload as text", () => {
    const text = "Escribe `data:image/png;base64,...` para incrustar una imagen.";
    expect(image(text)).toHaveLength(0);
    const short = splitInlineImages("data:image/png;base64,AAAA", { final: true });
    expect(short.every((segment) => segment.type === "text")).toBe(true);
  });

  it("renders a bare payload only when it is complete", () => {
    const bare = `data:image/webp;base64,${B64}`;
    expect(image(bare, true)).toHaveLength(1);
    const streaming = splitInlineImages(bare, { final: false });
    expect(streaming.map((segment) => segment.type)).toContain("pending");
    // The partial bytes never reach the transcript as text.
    for (const segment of streaming) {
      if (segment.type === "text") expect(segment.value).not.toContain("base64");
    }
  });

  it("stops growing a still-streaming payload past the render budget", () => {
    // No terminator yet, so the segment stays open while the reply streams.
    // Past the cap there is nothing left to wait for: the transcript must not
    // keep re-scanning (and hiding) a payload that can never render.
    const unterminated = `data:image/png;base64,${"A".repeat(MAX_INLINE_IMAGE_CHARS + 1)}`;
    expect(splitInlineImages(unterminated, { final: false }).map((segment) => segment.type)).toEqual([
      "oversized",
    ]);
    // One character under the cap still waits for the rest of the payload.
    expect(
      splitInlineImages(`data:image/png;base64,${"A".repeat(MAX_INLINE_IMAGE_CHARS - 40)}`, {
        final: false,
      }).map((segment) => segment.type),
    ).toEqual(["pending"]);
  });

  it("waits for the closing parenthesis while the reply streams", () => {
    const partial = `Mirá:\n![render](data:image/png;base64,${B64.slice(0, 40)}`;
    const segments = splitInlineImages(partial, { final: false });
    expect(segments.some((segment) => segment.type === "pending")).toBe(true);
    for (const segment of segments) {
      if (segment.type === "text") expect(segment.value).not.toContain("iVBORw0");
    }
    // Once the payload completes, the same text renders the picture.
    expect(image(`![render](data:image/png;base64,${B64})`)).toHaveLength(1);
  });

  it("never interprets model-authored html", () => {
    const text = '<img src=x onerror="alert(1)"> y <script>alert(1)</script>';
    const segments = splitInlineImages(text);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ type: "text", value: text });
  });

  it("leaves payloads inside a fenced code block untouched", () => {
    const text = ["```html", `![x](data:image/png;base64,${B64})`, "```"].join("\n");
    const segments = splitInlineImages(text);
    expect(segments).toHaveLength(1);
    if (segments[0].type !== "text") throw new Error("expected text");
    expect(segments[0].value).toContain("data:image/png;base64,");
  });

  it("keeps several images in order", () => {
    const text = `![uno](data:image/png;base64,${B64}) medio ![dos](data:image/gif;base64,${B64})`;
    const found = image(text);
    expect(found).toHaveLength(2);
    if (found[0].type !== "image" || found[1].type !== "image") throw new Error("images");
    expect(found[0].alt).toBe("uno");
    expect(found[1].alt).toBe("dos");
  });

  it("drops an oversized payload instead of the transcript", () => {
    const huge = "A".repeat(MAX_INLINE_IMAGE_CHARS + 8);
    const segments = splitInlineImages(`![x](data:image/png;base64,${huge})`);
    expect(segments.map((segment) => segment.type)).toEqual(["oversized"]);
  });

  it("reassembles the prose without the consumed syntax", () => {
    const text = `uno\n![x](data:image/png;base64,${B64})\ndos`;
    const prose = splitInlineImages(text)
      .filter((segment) => segment.type === "text")
      .map((segment) => (segment.type === "text" ? segment.value : ""))
      .join("");
    expect(prose).toContain("uno");
    expect(prose).toContain("dos");
    expect(prose).not.toContain("base64");
  });

  it("returns a single text segment for a plain reply", () => {
    expect(splitInlineImages("hola")).toEqual([{ type: "text", value: "hola" }]);
    expect(splitInlineImages("")).toEqual([{ type: "text", value: "" }]);
  });
});

describe("safe image sources", () => {
  const signed =
    "/api/hermes/media?path=%2Fopt%2Fdata%2Fcache%2Fscratch%2Fa.png&exp=999&sig=deadbeef";

  it("accepts the proxy's signed media url and a raster payload", () => {
    expect(safeImageSource(signed)).toBe(signed);
    expect(safeImageSource(`data:image/png;base64,${B64}`)).toBe(`data:image/png;base64,${B64}`);
  });

  it("rejects everything a model could invent", () => {
    expect(safeImageSource("https://evil.test/x.png")).toBeNull();
    expect(safeImageSource("javascript:alert(1)")).toBeNull();
    expect(safeImageSource("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBeNull();
    expect(safeImageSource("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(safeImageSource("/api/hermes/media?path=/etc/passwd")).toBeNull();
    expect(safeImageSource("/api/hermes/media?path=/opt/data/x.png&sig=abc")).toBeNull();
    expect(safeImageSource("")).toBeNull();
    expect(safeImageSource(null)).toBeNull();
  });
});
