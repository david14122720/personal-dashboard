import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HermesMarkdown from "./HermesMarkdown";

const B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

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

  it("renders only the proxy's signed media URL as an image", () => {
    const signed =
      "/api/hermes/media?path=%2Fopt%2Fdata%2Fcache%2Fscratch%2Fa.png&exp=999&sig=abc";
    const container = html(`![vista](${signed})`);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(signed);
    expect(img?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img?.className).toContain("max-w-full");
    expect(img?.className).toContain("rounded-lg");
  });

  it("refuses remote hosts and svg payloads", () => {
    const remote = html("![x](https://evil.test/a.png)");
    expect(remote.querySelector("img")).toBeNull();
    const svg = html(`![x](data:image/svg+xml;base64,${B64})`);
    expect(svg.querySelector("img")).toBeNull();
  });

  it("does not render an unsigned media path", () => {
    const container = html("![x](/api/hermes/media?path=/opt/data/cache/scratch/a.png)");
    expect(container.querySelector("img")).toBeNull();
  });
});
