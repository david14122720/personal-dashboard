import { describe, expect, it } from "vitest";
import {
  artifactExtension,
  artifactKind,
  collectArtifacts,
  documentFamily,
  downloadUrl,
  extensionOf,
  fileNameOf,
  isFileUrl,
  isSafeArtifactUrl,
} from "./artifacts";

describe("embedded payloads", () => {
  const payload =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

  it("never cards a data payload: the message body draws it inline", () => {
    const collected = collectArtifacts(`![x](data:image/png;base64,${payload})`);
    expect(collected.artifacts).toHaveLength(0);
    expect(collected.text).toContain("data:image/png;base64,");
  });
});

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

    const { artifacts } = collectArtifacts(reply, [
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
    const { artifacts } = collectArtifacts("[pwn](javascript:alert(1)) https://x.test/a.js");
    expect(artifacts.map((item) => item.url)).toEqual(["https://x.test/a.js"]);
    expect(isSafeArtifactUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeArtifactUrl("data:image/png;base64,aaa")).toBe(true);
    expect(isSafeArtifactUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isSafeArtifactUrl("data:application/zip;base64,aGk=")).toBe(false);
  });

  it("returns nothing for a plain conversational reply", () => {
    expect(collectArtifacts("Hoy el dólar cerró en $3.158.")).toEqual({ artifacts: [], text: "Hoy el dólar cerró en $3.158." });
  });

  it("turns a signed media artifact into a card and removes the raw path", () => {
    const path = "/opt/data/entregas/ensayo-celula.docx";
    const url = `/api/hermes/media?path=${encodeURIComponent(path)}&exp=1&sig=abc`;
    const { artifacts, text } = collectArtifacts(
      `Listo, te dejo el ensayo:\n\nMEDIA:${path}\n\nCualquier duda avisame.`,
      [{ name: "ensayo-celula.docx", url, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 2048, path }],
    );
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].path).toBe(path);
    expect(artifacts[0].kind).toBe("document");
    expect(artifacts[0].size).toBe(2048);
    expect(text).not.toContain("MEDIA:");
    expect(text).not.toContain("/opt/data");
    expect(text).toContain("Cualquier duda avisame.");
  });

  it("matches a bare absolute path the gateway prints for documents", () => {
    const path = "/opt/data/probe-doc.pdf";
    const url = `/api/hermes/media?path=${encodeURIComponent(path)}&exp=1&sig=abc`;
    const { artifacts, text } = collectArtifacts(`Tomá:\n\n${path}\n\nGracias.`, [
      { name: "probe-doc.pdf", url, mime: "application/pdf", path },
    ]);
    expect(artifacts.map((item) => item.name)).toEqual(["probe-doc.pdf"]);
    expect(text).toBe("Tomá:\n\nGracias.");
  });

  it("keeps an unmatched path visible but drops the MEDIA: prefix", () => {
    const { artifacts, text } = collectArtifacts("Mirá:\nMEDIA:/opt/data/otro.mp4");
    expect(artifacts).toHaveLength(0);
    expect(text).toBe("Mirá:\n/opt/data/otro.mp4");
  });

  it("reads the download parameter and the document family", () => {
    const path = "/opt/data/planilla.xlsx";
    const url = `/api/hermes/media?path=${encodeURIComponent(path)}&exp=1&sig=abc`;
    const artifact = { url, path, mime: undefined };
    expect(downloadUrl(url, "planilla final.xlsx")).toBe(`${url}&download=planilla%20final.xlsx`);
    expect(downloadUrl("https://x.test/a.pdf", "a.pdf")).toBe("https://x.test/a.pdf");
    expect(artifactExtension(artifact)).toBe("xlsx");
    expect(documentFamily(artifact)).toBe("excel");
    expect(documentFamily({ url: "/opt/data/a.docx", path: "/opt/data/a.docx" })).toBe("word");
    expect(documentFamily({ url: "/opt/data/a.pptx", path: "/opt/data/a.pptx" })).toBe("powerpoint");
    expect(documentFamily({ url: "/opt/data/a.zip", path: "/opt/data/a.zip" })).toBe("archive");
    expect(documentFamily({ url: "https://x.test/a.pdf", mime: "application/pdf" })).toBe("pdf");
  });

  it("never rewrites fenced code while stripping a delivered path", () => {
    const { text } = collectArtifacts("```python\ndef f():\n    return 1\n```");
    expect(text).toContain("    return 1");
    expect(text).toContain("```python");
  });

  it("strips a delivered path that contains spaces", () => {
    const path = "/opt/data/entregas/mi video final.mp4";
    const url = `/api/hermes/media?path=${encodeURIComponent(path)}&exp=1&sig=abc`;
    const { artifacts, text } = collectArtifacts(`Tomá:\nMEDIA:${path}\nContame.`, [
      { name: "mi video final.mp4", url, path, mime: "video/mp4" },
    ]);
    expect(artifacts).toHaveLength(1);
    expect(text).toBe("Tomá:\nContame.");
  });

  it("leaves the gateway's inline data image to the message body", () => {
    // Spec S4: the payload is drawn inline by `HermesMessageBody`, so carding
    // it here would duplicate every generated picture.
    const reply = "![image](data:image/png;base64,iVBORw0KGgo=";
    const { artifacts, text } = collectArtifacts(reply);
    expect(artifacts).toHaveLength(0);
    expect(text).toContain("data:image/png;base64,");
  });

  it("leaves a delivered path inside a fenced code block untouched", () => {
    const path = "/opt/data/entregas/ensayo.pdf";
    const url = `/api/hermes/media?path=${encodeURIComponent(path)}&exp=1&sig=abc`;
    const { text } = collectArtifacts(
      `Ejecutá:\n\n\`\`\`bash\ncp ${path} .\n\`\`\`\n\nMEDIA:${path}`,
      [{ name: "ensayo.pdf", url, path, mime: "application/pdf" }],
    );
    expect(text).toContain(`cp ${path} .`);
    expect(text).not.toContain(`MEDIA:${path}`);
  });

  it("removes the whole markdown link when its path is carded", () => {
    const path = "/opt/data/entregas/informe final.pdf";
    const url = `/api/hermes/media?path=${encodeURIComponent(path)}&exp=1&sig=abc`;
    const { artifacts, text } = collectArtifacts(
      `Listo: [el informe](${path}) y nada más.`,
      [{ name: "informe final.pdf", url, path, mime: "application/pdf" }],
    );
    expect(artifacts).toHaveLength(1);
    expect(text).not.toContain("[el informe]()");
    expect(text).not.toContain("]()");
    expect(text).toBe("Listo: y nada más.");
  });

  it("never touches the path inside any code shape", () => {
    const path = "/opt/data/entregas/informe.pdf";
    const url = `/api/hermes/media?path=${encodeURIComponent(path)}&exp=1&sig=abc`;
    const payload = [{ name: "informe.pdf", url, path, mime: "application/pdf" }];
    const shapes = [
      `Para escribir un bloque usá \`\`\` y después:\n\n\`\`\`bash\ncp ${path} .\n\`\`\`\n\nMEDIA:${path}`,
      `~~~bash\ncp ${path} .\n~~~\n\nMEDIA:${path}`,
      `\`\`\`\`md\n\`\`\`bash\ncp ${path} .\n\`\`\`\n\`\`\`\`\n\nMEDIA:${path}`,
      `    cp ${path} .\n\nMEDIA:${path}`,
    ];
    for (const reply of shapes) {
      const { text } = collectArtifacts(reply, payload);
      expect(text).toContain(`cp ${path} .`);
      expect(text).not.toContain(`MEDIA:${path}`);
    }
  });

  it("keeps a whole-line path inside a fenced block", () => {
    const path = "/tmp/render.png";
    const url = `/api/hermes/media?path=${encodeURIComponent(path)}&exp=1&sig=abc`;
    const reply = `Mirá el script:\n\n\`\`\`\nprint(1)\n${path}\n\`\`\`\n\n${path}`;
    const { text } = collectArtifacts(reply, [{ name: "render.png", url, path, mime: "image/png" }]);
    expect(text).toContain(`print(1)\n${path}`);
    expect(text.split("\n").filter((line) => line === path)).toHaveLength(1);
  });

  it("only closes a fence with its own marker and length", () => {
    const path = "/tmp/render.png";
    const url = `/api/hermes/media?path=${encodeURIComponent(path)}&exp=1&sig=abc`;
    const payload = [{ name: "render.png", url, path, mime: "image/png" }];
    const answer = `Ejemplo:\n\n\`\`\`\`md\n\`\`\`bash\ncp ${path} .\n\`\`\`\n\`\`\`\`\n\n${path}`;
    const { text } = collectArtifacts(answer, payload);
    expect(text).toContain(`cp ${path} .`);
    // The block is closed correctly, so the standalone card line is stripped.
    expect(text.endsWith(path)).toBe(false);
  });

  it("leaves an indented code line untouched", () => {
    const path = "/tmp/render.png";
    const url = `/api/hermes/media?path=${encodeURIComponent(path)}&exp=1&sig=abc`;
    const payload = [{ name: "render.png", url, path, mime: "image/png" }];
    const { text } = collectArtifacts(`Texto:\n\n    ${path}\n\n${path}`, payload);
    expect(text).toContain(`    ${path}`);
  });

  it("drops titled, angle-bracket and image links whose destination is delivered", () => {
    const path = "/opt/data/entregas/informe.pdf";
    const url = `/api/hermes/media?path=${encodeURIComponent(path)}&exp=1&sig=abc`;
    const payload = [{ name: "informe.pdf", url, path, mime: "application/pdf" }];
    for (const reply of [
      `Listo: [informe](${path} "descargar") y nada más.`,
      `Listo: [informe](<${path}>) y nada más.`,
      `Listo: ![informe](${path}) y nada más.`,
    ]) {
      const { text } = collectArtifacts(reply, payload);
      expect(text).toBe("Listo: y nada más.");
    }
  });
});
