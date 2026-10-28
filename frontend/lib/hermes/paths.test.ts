import { describe, expect, it } from "vitest";

import { scanMediaPaths } from "./paths";

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
});
