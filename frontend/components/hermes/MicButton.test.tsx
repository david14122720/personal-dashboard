import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MicButton from "./MicButton";

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = () => true;

  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(_stream: unknown, options?: { mimeType?: string }) {
    if (options?.mimeType) this.mimeType = options.mimeType;
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const stopTrack = vi.fn();

function stubMicrophone() {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })),
    },
  });
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  stopTrack.mockClear();
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  stubMicrophone();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MicButton", () => {
  it("records, shows the elapsed time and hands over a file on stop", async () => {
    const onRecorded = vi.fn();
    render(<MicButton onRecorded={onRecorded} />);

    fireEvent.click(screen.getByRole("button", { name: "Grabar nota de voz" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Grabando 0:00");
    expect(FakeMediaRecorder.instances[0].state).toBe("recording");

    fireEvent.click(screen.getByRole("button", { name: "Detener grabación y adjuntar" }));

    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    const file = onRecorded.mock.calls[0][0] as File;
    expect(file.name).toMatch(/^nota-de-voz-.*\.webm$/);
    expect(file.type.startsWith("audio/webm")).toBe(true);
    expect(file.size).toBeGreaterThan(0);
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Grabar nota de voz" })).toBeInTheDocument();
  });

  it("cancels without handing over a file", async () => {
    const onRecorded = vi.fn();
    render(<MicButton onRecorded={onRecorded} />);

    fireEvent.click(screen.getByRole("button", { name: "Grabar nota de voz" }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar grabación" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Grabar nota de voz" })).toBeInTheDocument());
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it("ignores a second click while the permission prompt is pending", async () => {
    let resolveStream: ((stream: MediaStream) => void) | null = null;
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveStream = resolve;
        }),
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    render(<MicButton onRecorded={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Grabar nota de voz" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    const stop = vi.fn();
    resolveStream!({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await screen.findByRole("status");
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(stop).not.toHaveBeenCalled();
  });

  it("stops a stream that arrives after unmount", async () => {
    let resolveStream: ((stream: MediaStream) => void) | null = null;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise<MediaStream>((resolve) => {
              resolveStream = resolve;
            }),
        ),
      },
    });

    const { unmount } = render(<MicButton onRecorded={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Grabar nota de voz" }));
    unmount();

    const stop = vi.fn();
    resolveStream!({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it("renders nothing when the browser cannot record", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const { container } = render(<MicButton onRecorded={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
