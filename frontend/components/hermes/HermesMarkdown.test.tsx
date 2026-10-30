import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HermesMarkdown from "./HermesMarkdown";

function html(source: string) {
  return render(<HermesMarkdown>{source}</HermesMarkdown>).container;
}

describe("hermes markdown", () => {
  it("renders rich typography: bold, lists, tables and links", () => {
    const container = html(
      [
        "**fuerte** y *énfasis*",
        "",
        "- uno",
        "- dos",
        "",
        "| a | b |",
        "| - | - |",
        "| 1 | 2 |",
        "",
        "[sitio](https://example.test/x)",
      ].join("\n"),
    );
    expect(container.querySelector("strong")).not.toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("table")).not.toBeNull();
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.test/x");
    expect(link?.getAttribute("rel")).toContain("noopener");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("highlights fenced code and keeps the source intact", () => {
    const source = ["```python", "def suma(a, b):", "    return a + b  # ojo", "```"].join("\n");
    const container = html(source);
    expect(container.querySelector("pre")).not.toBeNull();
    expect(container.querySelector('[data-token="keyword"]')?.textContent).toBe("def");
    expect(container.querySelector('[data-token="comment"]')?.textContent).toContain("# ojo");
  });

  it("shows an unknown language as a plain block", () => {
    const container = html("```brainfuck\n+++[>+<-]\n```");
    expect(container.querySelector("pre")?.textContent).toContain("+++[>+<-]");
    expect(container.querySelector("[data-token]")).toBeNull();
  });

  it("shows model-authored html as inert text instead of dropping it", () => {
    const container = html('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
    // Nothing becomes an element: no script, no image, no handler attribute.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    // Spec S11: the markup is escaped and stays readable, so the model's text
    // is not silently lost.
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.innerHTML).toContain("&lt;script&gt;");
  });

  it("keeps an html-looking payload inside a fence byte for byte", () => {
    const container = html('```\n<img src=x onerror="alert(1)">\n```');
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it("renders a model-authored image as its caption and never loads the url", () => {
    const container = html(
      [
        "Antes",
        "",
        "![](https://evil.test/x.png)",
        "![vista de prueba](https://evil.test/y.webp)",
        "",
        "**fuerte**",
        "",
        "- uno",
        "- dos",
        "",
        "```js",
        "const x = 1;",
        "```",
      ].join("\n"),
    );

    // Owner spec S2: a reply is clean Markdown. The caption survives as prose,
    // the remote url is never fetched and never reaches the DOM.
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("vista de prueba");
    expect(container.textContent).not.toContain("evil.test");
    // The rest of the Markdown still renders around the collapsed image.
    expect(container.querySelector("strong")?.textContent).toBe("fuerte");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("pre code")?.textContent).toContain("const x = 1;");
  });

  it("renders no image for any source, including a same-origin path or a data url", () => {
    const sources = [
      "/api/uploads/3f0f0a4e-6a4b-4c3d-8f2e-0b1c2d3e4f5a",
      "/api/hermes/media?path=%2Fopt%2Fdata%2Fu.png&exp=1&sig=x",
      "data:image/png;base64,iVBORw0KGgo=",
      "blob:http://lan.local/abc",
    ];
    for (const src of sources) {
      const container = html(`![captura](${src})`);
      expect(container.querySelector("img"), src).toBeNull();
      expect(container.textContent).toContain("captura");
    }
  });
});
