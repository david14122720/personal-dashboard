import { describe, expect, it } from "vitest";

import { filesUrl, isWholePathAt, removeWholePath, scanMediaPaths } from "./paths";

describe("filesUrl", () => {
  it("keeps the leading slash and never doubles it", () => {
    expect(filesUrl("/opt/data/cache/scratch/prueba_hermes.png")).toBe(
      "/files/opt/data/cache/scratch/prueba_hermes.png",
    );
    expect(filesUrl("/tmp/render.png")).toBe("/files/tmp/render.png");
    expect(filesUrl("opt/data/cache/scratch/prueba_hermes.docx")).toBe(
      "/files/opt/data/cache/scratch/prueba_hermes.docx",
    );
  });

  it("percent-encodes each segment so # and ? stay inside the path", () => {
    // B-007: a raw `#` or `?` becomes a fragment/query and truncates the path
    // the server receives, so the card would point at another file.
    expect(filesUrl("/opt/data/cache/scratch/a#b.png")).toBe(
      "/files/opt/data/cache/scratch/a%23b.png",
    );
    expect(filesUrl("/opt/data/cache/scratch/a?b.png")).toBe(
      "/files/opt/data/cache/scratch/a%3Fb.png",
    );
    expect(filesUrl("/opt/data/entregas/mi informe.pdf")).toBe(
      "/files/opt/data/entregas/mi%20informe.pdf",
    );
    // Encoding is per segment: the separators are never escaped.
    expect(filesUrl("/opt/data/v1..png")).toBe("/files/opt/data/v1..png");
    expect(filesUrl("/files/a b.png")).toBe("/files/files/a%20b.png");
  });
});

describe("scanMediaPaths", () => {
  it("finds MEDIA: paths, bare /opt/data paths and /tmp renders", () => {
    const text = [
      "Listo: MEDIA:/opt/data/entregas/demo.mp4",
      "El documento quedó en /opt/data/documentos_generados/informe.pdf.",
      "Y el render en /tmp/render.png",
    ].join("\n");
    expect(scanMediaPaths(text)).toEqual([
      "/opt/data/entregas/demo.mp4",
      "/opt/data/documentos_generados/informe.pdf",
      "/tmp/render.png",
    ]);
  });

  it("leaves paths with spaces to the proxy's line-based detector", () => {
    // A token split by spaces is not recoverable from prose; the backend
    // already signs those when the whole line is the path.
    expect(scanMediaPaths("MEDIA:/opt/data/entregas/video final.mp4")).toEqual([]);
    expect(scanMediaPaths("/opt/data/entregas/video final.mp4")).toEqual([]);
  });

  it("ignores paths without a media extension or outside the roots", () => {
    const text = "Corrí /opt/data/scripts/build.sh y /tmp/cache/app.env; también /home/user/x.pdf";
    expect(scanMediaPaths(text)).toEqual([]);
  });

  it("ignores a path embedded in a URL or a deeper tree", () => {
    expect(scanMediaPaths("mirá https://evil.test/tmp/photo.png")).toEqual([]);
    expect(scanMediaPaths("está en /var/tmp/x.png")).toEqual([]);
  });

  it("keeps multi-part archive extensions and log files", () => {
    expect(scanMediaPaths("/tmp/backup.tar.gz")).toEqual(["/tmp/backup.tar.gz"]);
    expect(scanMediaPaths("/opt/data/report.log")).toEqual(["/opt/data/report.log"]);
  });

  it("deduplicates and caps the list", () => {
    const text = Array.from({ length: 5 }, () => "/tmp/a.png").join(" ");
    expect(scanMediaPaths(text)).toEqual(["/tmp/a.png"]);
  });

  it("does not swallow trailing prose punctuation", () => {
    expect(scanMediaPaths("mirá /opt/data/x.docx.")).toEqual(["/opt/data/x.docx"]);
  });

  it("never scans a path that is only the prefix of a longer file name", () => {
    // B-008: `/tmp/render.png.bak` is another file; the `.bak` must not be
    // truncated into a card for `/tmp/render.png`.
    expect(scanMediaPaths("Guarde /tmp/render.png y /tmp/render.png.bak")).toEqual([
      "/tmp/render.png",
    ]);
  });

  it("never scans the path= value of the app's own upload reference", () => {
    // B-008: the reference the chat itself inserts points at the signed media
    // route; the path lives inside a URL query, not as a bare path.
    expect(
      scanMediaPaths(
        "[archivo adjunto: http://192.168.50.120:8080/api/hermes/media?path=/opt/data/uploads/informe.pdf]",
      ),
    ).toEqual([]);
  });
});

describe("whole path boundary", () => {
  const path = "/tmp/render.png";

  it("accepts a path that stands alone in the prose", () => {
    expect(isWholePathAt(`Guarde ${path} y más`, "Guarde ".length, path.length)).toBe(true);
    expect(isWholePathAt(`${path}.`, 0, path.length)).toBe(true);
    expect(isWholePathAt(`${path}, ok`, 0, path.length)).toBe(true);
    expect(isWholePathAt(`(${path})`, 1, path.length)).toBe(true);
    expect(isWholePathAt(`${path}...`, 0, path.length)).toBe(true);
  });

  it("rejects a path that is only a slice of a longer token", () => {
    expect(isWholePathAt(`${path}.bak`, 0, path.length)).toBe(false);
    expect(isWholePathAt(`x${path}`, 1, path.length)).toBe(false);
    expect(isWholePathAt(`/var${path}`, "/var".length, path.length)).toBe(false);
    // The `path=` value of a URL is part of a longer token, not a bare path.
    expect(isWholePathAt(`?path=${path}`, "?path=".length, path.length)).toBe(false);
    expect(isWholePathAt(`x${path}`, -1, path.length)).toBe(false);
    expect(isWholePathAt(`${path}x`, 0, path.length)).toBe(false);
  });

  it("removes only the whole tokens from a line", () => {
    expect(removeWholePath(`Guarde ${path} y ${path}.bak`, path)).toBe(
      `Guarde  y ${path}.bak`,
    );
    expect(removeWholePath(`?path=${path}`, path)).toBe(`?path=${path}`);
    expect(removeWholePath("nada que ver", path)).toBe("nada que ver");
  });
});
