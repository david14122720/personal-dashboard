import { describe, expect, it } from "vitest";
import {
  artifactKind,
  collectArtifacts,
  extensionOf,
  fileNameOf,
  isFileUrl,
  isSafeArtifactUrl,
} from "./artifacts";

describe("hermes artifacts", () => {
  it("reads the extension and file name from a url", () => {
    expect(extensionOf("https://example.test/reportes/ventas.PDF?v=2")).toBe("pdf");
    expect(fileNameOf("https://example.test/reportes/ventas%20oct.pdf")).toBe("ventas oct.pdf");
    expect(extensionOf("data:text/plain;base64,aGk=")).toBe("");
  });

  it("maps kinds from mime first and extension second", () => {
    expect(artifactKind("image/png", "https://x.test/a")).toBe("image");
    expect(artifactKind("audio/webm", "https://x.test/a")).toBe("audio");
    expect(artifactKind(undefined, "https://x.test/a.zip")).toBe("document");
    expect(artifactKind(undefined, "https://x.test/a.py")).toBe("code");
    expect(artifactKind(undefined, "https://x.test/a.unknown")).toBe("file");
  });

  it("only treats known file links as artifacts", () => {
    expect(isFileUrl("https://x.test/a.png")).toBe(true);
    expect(isFileUrl("https://x.test/a.png?size=2")).toBe(true);
    expect(isFileUrl("https://x.test/documento")).toBe(false);
    expect(isFileUrl("javascript:alert(1)")).toBe(false);
    expect(isFileUrl("data:text/plain;base64,aGk=")).toBe(true);
    expect(isFileUrl("data:application/zip;base64,aGk=")).toBe(false);
  });

  it("collects the proxy payload and markdown links without duplicates", () => {
    const reply = [
      "Listo, te dejo el reporte:",
      "",
      "[Reporte de octubre](https://example.test/octubre.pdf)",
      "![Gráfico](https://example.test/grafico.png)",
      "También https://example.test/notas.md y https://example.test/octubre.pdf",
      "[un enlace normal](https://example.test/inicio) no es archivo.",
    ].join("\n");

    const artifacts = collectArtifacts(reply, [
      { name: "Reporte de octubre", url: "https://example.test/octubre.pdf", mime: "application/pdf", size: 1234 },
    ]);

    expect(artifacts.map((item) => item.name)).toEqual([
      "Reporte de octubre",
      "Gráfico",
      "notas.md",
    ]);
    expect(artifacts[0].size).toBe(1234);
    expect(artifacts[0].kind).toBe("document");
    expect(artifacts[1].kind).toBe("image");
    expect(artifacts[2].kind).toBe("code");
  });

  it("drops unsafe urls even when the agent asks for them", () => {
    const artifacts = collectArtifacts("[pwn](javascript:alert(1)) https://x.test/a.js");
    expect(artifacts.map((item) => item.url)).toEqual(["https://x.test/a.js"]);
    expect(isSafeArtifactUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeArtifactUrl("data:image/png;base64,aaa")).toBe(true);
    expect(isSafeArtifactUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isSafeArtifactUrl("data:application/zip;base64,aGk=")).toBe(false);
  });

  it("returns nothing for a plain conversational reply", () => {
    expect(collectArtifacts("Hoy el dólar cerró en $3.158.")).toEqual([]);
  });
});
