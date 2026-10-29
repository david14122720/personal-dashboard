import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HermesMessageBody from "./HermesMessageBody";

const B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

describe("hermes message body", () => {
  it("renders a settled base64 picture inline", () => {
    const { container } = render(
      <HermesMessageBody content={`Mirá:\n![render](data:image/png;base64,${B64})`} final />,
    );
    const image = screen.getByTestId("hermes-inline-image");
    expect(image.getAttribute("src")).toBe(`data:image/png;base64,${B64}`);
    expect(image.getAttribute("alt")).toBe("render");
    expect(image.className).toContain("max-w-full");
    expect(image.className).toContain("rounded-lg");
    expect(image.className).toContain("shadow-md");
    expect(container.textContent).not.toContain("base64");
  });

  it("shows the picture while the reply is still streaming", () => {
    const { container } = render(
      <HermesMessageBody content={`![x](data:image/webp;base64,${B64})`} final={false} />,
    );
    expect(container.querySelector('[data-testid="hermes-inline-image"]')).not.toBeNull();
  });

  it("hides a half-received payload behind a placeholder", () => {
    const { container } = render(
      <HermesMessageBody
        content={`Procesando\n![x](data:image/png;base64,${B64.slice(0, 30)}`}
        final={false}
      />,
    );
    expect(screen.queryByTestId("hermes-inline-image")).toBeNull();
    expect(screen.getByTestId("hermes-pending-image")).not.toBeNull();
    expect(container.textContent).not.toContain("iVBORw0");
  });

  it("keeps the prose when a payload is too large to draw", () => {
    const huge = "A".repeat(8 * 1024 * 1024 + 16);
    const { container } = render(
      <HermesMessageBody content={`Antes\n![x](data:image/png;base64,${huge})\nDespués`} final />,
    );
    expect(screen.getByTestId("hermes-oversized-image")).not.toBeNull();
    expect(container.textContent).toContain("Antes");
    expect(container.textContent).toContain("Después");
    expect(container.textContent).not.toContain("AAAA");
  });

  it("still renders markdown and never raw html", () => {
    const { container } = render(
      <HermesMessageBody content={"**fuerte**\n\n<script>alert(1)</script>"} final />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("fuerte");
    expect(container.querySelector("script")).toBeNull();
  });
});
