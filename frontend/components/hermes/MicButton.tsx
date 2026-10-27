"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { voiceFileName } from "@/lib/hermes/attachments";
import { t } from "@/lib/i18n";

type Phase = "idle" | "recording" | "unsupported" | "denied";

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported?.(candidate)) return candidate;
  }
  return "";
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/**
 * Voice note recorder. `MediaRecorder` streams the microphone into a single
 * `File`; the caller decides where it goes. Nothing is uploaded here.
 */
export default function MicButton({
  onRecorded,
  disabled = false,
}: {
  onRecorded: (file: File) => void;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  const recordedRef = useRef(onRecorded);
  recordedRef.current = onRecorded;

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const teardown = useCallback(() => {
    stopTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      cancelledRef.current = true;
      recorder.stop();
    }
    recorderRef.current = null;
    stopTracks();
    chunksRef.current = [];
    setPhase("idle");
    setSeconds(0);
  }, [stopTimer, stopTracks]);

  useEffect(() => {
    mountedRef.current = true;
    const supported =
      typeof window !== "undefined" &&
      typeof window.MediaRecorder !== "undefined" &&
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function";
    if (!supported) setPhase("unsupported");
    return () => {
      // A pending permission prompt can resolve after this runs; `start`
      // checks `mountedRef` and stops the stream it obtains.
      mountedRef.current = false;
      teardown();
    };
  }, [teardown]);

  async function start() {
    // One permission prompt at a time: a second click while `getUserMedia`
    // is pending would create a second recorder whose stream is never stored
    // and therefore never stopped.
    if (startingRef.current || recorderRef.current) return;
    startingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || recorderRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      cancelledRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stopTimer();
        stopTracks();
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        recorderRef.current = null;
        setPhase("idle");
        setSeconds(0);
        if (cancelledRef.current || blob.size === 0) return;
        recordedRef.current(new File([blob], voiceFileName(type), { type }));
      };

      recorder.start(250);
      recorderRef.current = recorder;
      setPhase("recording");
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch {
      if (mountedRef.current) setPhase("denied");
      stopTracks();
    } finally {
      startingRef.current = false;
    }
  }

  function stop() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    cancelledRef.current = false;
    recorder.stop();
  }

  function cancel() {
    const recorder = recorderRef.current;
    cancelledRef.current = true;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else teardown();
  }

  if (phase === "unsupported") return null;

  if (phase === "recording") {
    return (
      <div className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-rose-200">
          <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-rose-400" />
          <span role="status" aria-live="polite" className="sr-only">
            {t("hermes.recording", { time: formatClock(seconds) })}
          </span>
          <span aria-hidden="true" className="tabular-nums">
            {formatClock(seconds)}
          </span>
        </span>
        <button
          type="button"
          onClick={stop}
          aria-label={t("hermes.stopRecording")}
          title={t("hermes.stopRecording")}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-rose-500/20 text-rose-100 transition-colors hover:bg-rose-500/30"
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
            <rect x="5" y="5" width="10" height="10" rx="1.5" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          onClick={cancel}
          aria-label={t("hermes.cancelRecording")}
          title={t("hermes.cancelRecording")}
          className="flex h-8 w-8 items-center justify-center rounded-md text-rose-200/80 transition-colors hover:bg-rose-500/20"
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled}
      aria-label={t("hermes.record")}
      title={phase === "denied" ? t("hermes.micDenied") : t("hermes.record")}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-hair bg-deck text-muted transition-colors hover:border-sky-500/40 hover:text-sky-300 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
        <rect x="7.5" y="3" width="5" height="8.5" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M4.5 9.5a5.5 5.5 0 0011 0M10 15v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </button>
  );
}
