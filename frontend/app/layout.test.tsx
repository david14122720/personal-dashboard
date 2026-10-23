import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// `next/font/google` resolves real font files at build time; the layout only
// needs the class names it contributes, so the factories are stubbed here.
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-stub", className: "font-stub" });
  return {
    Space_Grotesk: font,
    Inter: font,
    IBM_Plex_Mono: font,
    Plus_Jakarta_Sans: font,
  };
});

import RootLayout from "./layout";

describe("root layout favicon", () => {
  it("declares the SVG favicon and no legacy icon reference", () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <p>contenido</p>
      </RootLayout>,
    );

    expect(markup).toContain(
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>',
    );
    expect(markup).not.toMatch(/favicon\.ico/);
  });
});
