import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ArtifactCard from "./ArtifactCard";

const DATA_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wFkA1xQAAAAAElFTkSuQmCC";

describe("ArtifactCard", () => {
  it("never auto-loads a remote file: no preview, explicit Ver and Descargar", () => {
    const { container } = render(
      <ArtifactCard
        artifact={{
          id: "a",
          name: "grafico.png",
          url: "https://tracker.test/pixel.png",
          kind: "image",
        }}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("link", { name: "Ver" })).toHaveAttribute(
      "href",
      "https://tracker.test/pixel.png",
    );
    expect(screen.getByRole("link", { name: "Descargar grafico.png" })).toHaveAttribute(
      "download",
      "grafico.png",
    );
  });

  it("previews an embedded payload without a network request", () => {
    const { container } = render(
      <ArtifactCard
        artifact={{ id: "b", name: "pixel.png", url: DATA_PNG, kind: "image", mime: "image/png" }}
      />,
    );
    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute("src", DATA_PNG);
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("keeps the audio player for a remote audio artifact without preloading it", () => {
    const { container } = render(
      <ArtifactCard
        artifact={{ id: "c", name: "voz.webm", url: "https://x.test/voz.webm", kind: "audio" }}
      />,
    );
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio).toHaveAttribute("preload", "none");
    expect(screen.getByRole("link", { name: "Ver" })).toBeInTheDocument();
  });
});
