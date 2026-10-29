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
  isFilesUrl,
  isSafeArtifactUrl,
  pathArtifacts,
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

  it("cards a mid-sentence image path with the stable /files url and removes it", () => {
    // Spec S9/S11: the scanned path becomes `<img src="/files/<path>">`, so the
    // card points at the stable file server and the prose keeps no raw path.
    const path = "/opt/data/cache/scratch/prueba_hermes.png";
    const reply = `Listo, ya generé la prueba: ${path} (mirala arriba) y quedó guardada.`;
    const { artifacts, text } = collectArtifacts(reply, pathArtifacts(reply));

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      name: "prueba_hermes.png",
      url: "/files/opt/data/cache/scratch/prueba_hermes.png",
      path,
      kind: "image",
    });
    expect(text).not.toContain(path);
    expect(text).toBe("Listo, ya generé la prueba: (mirala arriba) y quedó guardada.");
  });

  it("cards a mid-sentence document path as a document", () => {
    // The backend forces `Content-Disposition: attachment` for documents; the
    // client only has to draw the card and point it at `/files/<path>`.
    const path = "/opt/data/cache/scratch/prueba_hermes.docx";
    const reply = `Acá va el Word: ${path} descargalo cuando quieras.`;
    const { artifacts, text } = collectArtifacts(reply, pathArtifacts(reply));

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      name: "prueba_hermes.docx",
      url: "/files/opt/data/cache/scratch/prueba_hermes.docx",
      kind: "document",
    });
    expect(text).not.toContain(path);
    expect(text).toBe("Acá va el Word: descargalo cuando quieras.");
  });

  it("accepts a same-origin /files url but rejects traversal", () => {
    expect(isSafeArtifactUrl("/files/opt/data/cache/scratch/prueba_hermes.png")).toBe(true);
    expect(isSafeArtifactUrl("/files/opt/data/../../etc/passwd")).toBe(false);
    expect(isSafeArtifactUrl("/files/opt/data/..%2F..%2Fetc/passwd")).toBe(false);
  });

  it("leaves a delivered path inside a fenced block untouched", () => {
    const path = "/opt/data/cache/scratch/prueba_hermes.png";
    const reply = `Corré:\n\n\`\`\`bash\ncp ${path} .\n\`\`\`\n\nY después mirá ${path} cuando quieras.`;
    const { artifacts, text } = collectArtifacts(reply, pathArtifacts(reply));

    expect(artifacts).toHaveLength(1);
    expect(text).toContain(`cp ${path} .`);
    expect(text).not.toContain(`mirá ${path}`);
  });

  it("never eats the shared prefix of a longer token", () => {
    // B-008: `split(path).join("")` also deleted the prefix of
    // `/tmp/render.png.bak`, corrupting the text around the card.
    const reply = "Guarde /tmp/render.png y /tmp/render.png.bak";
    const { artifacts, text } = collectArtifacts(reply, pathArtifacts(reply));

    expect(artifacts.map((item) => item.url)).toEqual(["/files/tmp/render.png"]);
    expect(text).toBe("Guarde y /tmp/render.png.bak");
  });

  it("keeps the app's own upload reference intact", () => {
    // B-008: the reference the chat inserts is a URL; deleting its `path=`
    // value left `…?path=]`, a broken link and a lost pointer.
    const path = "/opt/data/uploads/informe.pdf";
    const reference = `[archivo adjunto: http://192.168.50.120:8080/api/hermes/media?path=${path}]`;
    const reply = `Listo, lo adjunté: ${reference}`;
    const signed = `/api/hermes/media?path=${encodeURIComponent(path)}&exp=1&sig=abc`;
    const { text } = collectArtifacts(reply, [
      { name: "informe.pdf", url: signed, mime: "application/pdf", size: 2048, path },
    ]);

    expect(text).toContain(`?path=${path}]`);
    expect(text).not.toContain("?path=]");
    // The scanned payload agrees: a path inside a URL is not a bare path.
    expect(pathArtifacts(reply)).toEqual([]);
  });

  it("leaves an inline code span untouched", () => {
    // PRESERVE: the path stripper only rewrites prose; a command the agent
    // shows inline stays byte for byte, next to the card it also produced.
    const path = "/opt/data/cache/scratch/prueba_hermes.png";
    const reply = `Copiá con \`cp ${path} .\` y después mirá ${path} de nuevo.`;
    const { artifacts, text } = collectArtifacts(reply, pathArtifacts(reply));

    expect(artifacts).toHaveLength(1);
    expect(text).toBe(`Copiá con \`cp ${path} .\` y después mirá de nuevo.`);
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

describe("files url", () => {
  it("recognises a safe /files address and rejects traversal", () => {
    expect(isFilesUrl("/files/opt/data/cache/scratch/a.png")).toBe(true);
    expect(isFilesUrl("/files/opt/data/../../etc/passwd")).toBe(false);
    expect(isFilesUrl("/files//etc/passwd")).toBe(false);
    expect(isFilesUrl("https://evil.test/files/a.png")).toBe(false);
  });

  it("accepts a file name that merely contains two dots", () => {
    // B-006: `..` is traversal as a whole segment, not as a substring.
    expect(isFilesUrl("/files/opt/data/cache/scratch/v1..png")).toBe(true);
    expect(isFilesUrl("/files/opt/data/a..b/c..d.pdf")).toBe(true);
    expect(isSafeArtifactUrl("/files/opt/data/cache/scratch/v1..png")).toBe(true);
  });

  it("still rejects a whole .. segment wherever it appears", () => {
    expect(isFilesUrl("/files/opt/data/../etc/passwd")).toBe(false);
    expect(isFilesUrl("/files/..")).toBe(false);
    expect(isFilesUrl("/files/opt/data/..%2F..%2Fetc/passwd")).toBe(false);
    expect(isSafeArtifactUrl("/files/opt/data/../etc/passwd")).toBe(false);
  });

  it("encodes the card url but keeps the name from the raw path", () => {
    // B-007: the raw `#` must not truncate the URL, and the label must never
    // come out of the encoded URL as `informe%231.pdf`.
    const path = "/opt/data/cache/scratch/informe#1.pdf";
    const reply = `Listo: ${path}`;
    const { artifacts, text } = collectArtifacts(reply, pathArtifacts(reply));

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      url: "/files/opt/data/cache/scratch/informe%231.pdf",
      name: "informe#1.pdf",
    });
    expect(text).toBe("Listo:");
  });

  it("keeps a file name with a question mark as one name", () => {
    const path = "/tmp/a?b.png";
    const { artifacts } = collectArtifacts(`Mirá ${path}`, pathArtifacts(`Mirá ${path}`));

    expect(artifacts[0]).toMatchObject({
      url: "/files/tmp/a%3Fb.png",
      name: "a?b.png",
      kind: "image",
    });
  });

  it("appends the download name to either url shape", () => {
    expect(downloadUrl("/files/opt/data/x.docx", "informe x.docx")).toBe(
      "/files/opt/data/x.docx?download=informe%20x.docx",
    );
    expect(downloadUrl("/api/hermes/media?path=/opt/data/a&sig=1", "a.png")).toBe(
      "/api/hermes/media?path=/opt/data/a&sig=1&download=a.png",
    );
  });
});
