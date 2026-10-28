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
    expect(screen.getByRole("link", { name: "Descargar: grafico.png" })).toHaveAttribute(
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

  it("shows a document badge and forces the download through the proxy", () => {
    const path = "/opt/data/entregas/ensayo-celula.docx";
    const url = `/api/hermes/media?path=${encodeURIComponent(path)}&exp=1&sig=abc`;
    render(
      <ArtifactCard
        artifact={{
          id: path,
          name: "ensayo-celula.docx",
          url,
          path,
          mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          size: 2048,
          kind: "document",
        }}
      />,
    );
    const badge = screen.getByTestId("hermes-artifact-badge");
    expect(badge).toHaveTextContent("DOCX");
    expect(screen.getByText(/application\/vnd\.openxmlformats/)).toBeInTheDocument();
    expect(screen.getByText(/2 KB/)).toBeInTheDocument();
    const link = screen.getByTestId("hermes-artifact-download");
    expect(link).toHaveAttribute("href", `${url}&download=ensayo-celula.docx`);
    expect(link).toHaveAttribute("download", "ensayo-celula.docx");
    expect(link).toHaveAccessibleName("Descargar archivo: ensayo-celula.docx");
  });

  it("gives a video a native player pointing at the signed media url", () => {
    const path = "/opt/data/videos/clip.mp4";
    const url = `/api/hermes/media?path=${encodeURIComponent(path)}&exp=1&sig=abc`;
    const { container } = render(
      <ArtifactCard artifact={{ id: path, name: "clip.mp4", url, path, kind: "video", size: 50 * 1024 * 1024 }} />,
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("src", url);
    expect(video).toHaveAttribute("preload", "none");
    expect(screen.getByRole("link", { name: "Descargar: clip.mp4" })).toHaveAttribute(
      "href",
      `${url}&download=clip.mp4`,
    );
  });

  it("previews a signed media image without a remote beacon", () => {
    const path = "/opt/data/fotos/plano.png";
    const url = `/api/hermes/media?path=${encodeURIComponent(path)}&exp=1&sig=abc`;
    const { container } = render(
      <ArtifactCard artifact={{ id: path, name: "plano.png", url, path, kind: "image", mime: "image/png" }} />,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", url);
  });
});
