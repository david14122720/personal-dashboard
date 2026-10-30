import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HermesMessageBody from "./HermesMessageBody";

describe("hermes message body", () => {
  it("renders the reply as sanitized Markdown", () => {
    const { container } = render(
      <HermesMessageBody content={"**fuerte**\n\n- uno\n- dos"} final />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("fuerte");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("never turns a model-authored image into an element", () => {
    const { container } = render(
      <HermesMessageBody content={"Mirá:\n![render](https://evil.test/x.png)"} final />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("render");
    expect(container.textContent).not.toContain("evil.test");
  });

  it("renders the same body while streaming and once settled", () => {
    const source = "**hola**\n\n```js\nconst x = 1;\n```";
    const streaming = render(<HermesMessageBody content={source} final={false} />).container;
    const settled = render(<HermesMessageBody content={source} final />).container;
    expect(streaming.innerHTML).toBe(settled.innerHTML);
    expect(streaming.querySelector("pre code")?.textContent).toContain("const x = 1;");
  });

  it("still renders markdown and never raw html", () => {
    const { container } = render(
      <HermesMessageBody content={"**fuerte**\n\n<script>alert(1)</script>"} final />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("fuerte");
    expect(container.querySelector("script")).toBeNull();
  });
});
