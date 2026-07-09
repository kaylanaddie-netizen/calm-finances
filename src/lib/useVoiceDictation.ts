import { useCallback, useEffect, useRef, useState } from "react";

// Reliable rolling WAV dictation via Lovable AI streaming transcription.
// Requests mic permission on start, streams a rolling PCM buffer to
// /api/transcribe, and auto-stops after a period of silence.

type Options = {
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
  onError?: (message: string) => void;
  onAutoStop?: () => void; // fired when we auto-stop after silence
};

const TARGET_SAMPLE_RATE = 16000;
const WINDOW_MS = 2000;
const SILENCE_MS = 1200;      // commit segment after this quiet
const AUTOSTOP_MS = 2500;     // fully stop + auto-submit after this quiet
const SILENCE_RMS = 0.012;

function floatTo16BitPCM(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return input;
  const ratio = from / to;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  let o = 0, i = 0;
  while (o < outLen) {
    const next = Math.floor((o + 1) * ratio);
    let sum = 0, count = 0;
    for (; i < next && i < input.length; i++) { sum += input[i]; count++; }
    out[o++] = count > 0 ? sum / count : 0;
  }
  return out;
}
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const pcm = floatTo16BitPCM(samples);
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF"); view.setUint32(4, 36 + pcm.length * 2, true);
  writeStr(8, "WAVE"); writeStr(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeStr(36, "data"); view.setUint32(40, pcm.length * 2, true);
  let o = 44;
  for (let i = 0; i < pcm.length; i++, o += 2) view.setInt16(o, pcm[i], true);
  return new Blob([buffer], { type: "audio/wav" });
}
function concat(chunks: Float32Array[]) {
  let len = 0; for (const c of chunks) len += c.length;
  const out = new Float32Array(len);
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export function useVoiceDictation({ onFinal, onInterim, onError, onAutoStop }: Options) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<ScriptProcessorNode | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const segmentPcmRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef(48000);
  const abortRef = useRef<AbortController | null>(null);
  const lastVoiceAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inflightRef = useRef(false);
  const listeningRef = useRef(false);
  const stopReqRef = useRef(false);

  const cleanup = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    abortRef.current?.abort();
    abortRef.current = null;
    try { nodeRef.current?.disconnect(); } catch {}
    try { srcRef.current?.disconnect(); } catch {}
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    try { void ctxRef.current?.close(); } catch {}
    nodeRef.current = null;
    srcRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
    segmentPcmRef.current = [];
    inflightRef.current = false;
    listeningRef.current = false;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const transcribeCurrent = useCallback(
    async (commit: boolean) => {
      if (inflightRef.current) return;
      const chunks = segmentPcmRef.current;
      if (chunks.length === 0) return;
      const merged = concat(chunks);
      if (merged.length < sampleRateRef.current * 0.4) return;
      const down = downsample(merged, sampleRateRef.current, TARGET_SAMPLE_RATE);
      const wav = encodeWav(down, TARGET_SAMPLE_RATE);
      if (wav.size < 2048) return;

      const form = new FormData();
      form.append("file", wav, "recording.wav");
      const ac = new AbortController();
      abortRef.current = ac;
      inflightRef.current = true;
      setTranscribing(true);

      try {
        const res = await fetch("/api/transcribe", { method: "POST", body: form, signal: ac.signal });
        if (!res.ok || !res.body) {
          const msg = await res.text().catch(() => "");
          onError?.(msg || `Transcription failed (${res.status})`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "", running = "", finalText = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const evt = JSON.parse(payload);
              if (evt.type === "transcript.text.delta" && typeof evt.delta === "string") {
                running += evt.delta;
                onInterim(running);
              } else if (evt.type === "transcript.text.done" && typeof evt.text === "string") {
                finalText = evt.text;
              }
            } catch {}
          }
        }
        const text = (finalText || running).trim();
        if (commit && text) {
          onFinal(text);
          segmentPcmRef.current = [];
          onInterim("");
        } else if (text) {
          onInterim(text);
        }
      } catch (e) {
        if ((e as any)?.name !== "AbortError") {
          onError?.(e instanceof Error ? e.message : "Transcription error");
        }
      } finally {
        inflightRef.current = false;
        setTranscribing(false);
      }
    },
    [onFinal, onInterim, onError],
  );

  const start = useCallback(async () => {
    if (listeningRef.current) return;
    stopReqRef.current = false;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      onError?.("Voice input isn't supported in this browser.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      const err = e as DOMException;
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
        onError?.("Microphone access was blocked. Allow it in your browser settings and try again.");
      } else if (err?.name === "NotFoundError") {
        onError?.("No microphone found.");
      } else {
        onError?.(err?.message || "Couldn't access the microphone.");
      }
      return;
    }
    try {
      streamRef.current = stream;
      const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new AC();
      // resume in case it starts suspended (iOS Safari)
      if (ctx.state === "suspended") { try { await ctx.resume(); } catch {} }
      ctxRef.current = ctx;
      sampleRateRef.current = ctx.sampleRate;
      const src = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      srcRef.current = src;
      nodeRef.current = node;
      lastVoiceAtRef.current = Date.now();

      node.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        segmentPcmRef.current.push(copy);
        let sum = 0;
        for (let i = 0; i < copy.length; i++) sum += copy[i] * copy[i];
        const rms = Math.sqrt(sum / copy.length);
        if (rms > SILENCE_RMS) lastVoiceAtRef.current = Date.now();
      };
      src.connect(node);
      node.connect(ctx.destination);

      let lastRun = Date.now();
      timerRef.current = setInterval(() => {
        if (!listeningRef.current) return;
        const now = Date.now();
        const quiet = now - lastVoiceAtRef.current;
        if (quiet > AUTOSTOP_MS && segmentPcmRef.current.length > 0) {
          // auto-stop
          void (async () => {
            if (stopReqRef.current) return;
            stopReqRef.current = true;
            listeningRef.current = false;
            setListening(false);
            try { await transcribeCurrent(true); } catch {}
            cleanup();
            onAutoStop?.();
          })();
        } else if (quiet > SILENCE_MS && segmentPcmRef.current.length > 0) {
          lastRun = now;
          void transcribeCurrent(true);
        } else if (now - lastRun > WINDOW_MS) {
          lastRun = now;
          void transcribeCurrent(false);
        }
      }, 250);

      listeningRef.current = true;
      setListening(true);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Couldn't start voice input.");
      cleanup();
    }
  }, [transcribeCurrent, cleanup, onError, onAutoStop]);

  const stop = useCallback(async () => {
    if (!listeningRef.current) return;
    stopReqRef.current = true;
    listeningRef.current = false;
    setListening(false);
    try { await transcribeCurrent(true); } catch {}
    cleanup();
  }, [transcribeCurrent, cleanup]);

  return { listening, transcribing, start, stop };
}
