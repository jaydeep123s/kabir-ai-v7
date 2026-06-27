// audio-listen.ts — KABIR AI v7 FIXED
// Dual audio capture: Mic (candidate) + Speaker/Loopback (interviewer via HDMI/capture card)
// Architecture:
//   MIC stream   → VAD → MediaRecorder (opus) → Whisper → AI (speaker=Candidate)
//   SPKR stream  → VAD → MediaRecorder (opus) → Whisper → AI (speaker=Interviewer)
//   Both run in parallel. Silence-gapped auto-flush.

export interface DualAudioOptions {
  onTranscript: (text: string, speaker: "Interviewer" | "Candidate", isFinal: boolean) => void;
  onStatus: (msg: string, type?: "ok" | "busy" | "error") => void;
  silenceThresholdDb: number;
  togetherKey: string;
}

interface AudioChannel {
  stream:          MediaStream;
  ctx:             AudioContext;
  src:             MediaStreamAudioSourceNode;
  processor:       ScriptProcessorNode;
  recorder:        MediaRecorder;
  chunks:          Blob[];
  vadState:        "silent" | "speaking" | "ending";
  silTimer:        ReturnType<typeof setTimeout> | null;
  locked:          boolean;
  label:           string;
  speaker:         "Interviewer" | "Candidate";
}

let micChannel:  AudioChannel | null = null;
let spkrChannel: AudioChannel | null = null;
let running = false;
let opts: DualAudioOptions | null = null;

// ── Device listing ─────────────────────────────────────────────────────────────
export async function populateAudioDevices(
  micSelect: HTMLSelectElement,
  spkrSelect: HTMLSelectElement
): Promise<void> {
  try {
    // Permission request
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach(t => t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(d => d.kind === "audioinput");

    const buildOptions = (sel: HTMLSelectElement, defaultLabel: string) => {
      sel.innerHTML = "";
      const def = document.createElement("option");
      def.value = "";
      def.textContent = defaultLabel;
      sel.appendChild(def);
      inputs.forEach((d, i) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        const lbl = d.label || `Audio Input ${i + 1}`;
        const isCap = /capture|hdmi|usb|elgato|magewell|avermedia|digital audio/i.test(lbl);
        const isStereo = /stereo mix|what u hear|loopback|virtual|vb-audio|voicemeeter/i.test(lbl);
        let prefix = "🎙";
        if (isCap)    prefix = "🎬";
        if (isStereo) prefix = "🔊";
        opt.textContent = `${prefix} ${lbl}`;
        // Auto-select: capture card → spkr input, else mic default
        if (isStereo || isCap) {
          if (sel === spkrSelect) opt.selected = true;
        }
        sel.appendChild(opt);
      });
    };

    buildOptions(micSelect,  "🎙 Default Mic (You)");
    buildOptions(spkrSelect, "🔊 Speaker/Capture (Interviewer)");
  } catch (e) {
    console.error("[audio] device enum error:", e);
  }
}

// ── Start dual capture ────────────────────────────────────────────────────────
export async function startDualCapture(
  micDeviceId: string | null,
  spkrDeviceId: string | null,
  options: DualAudioOptions
): Promise<boolean> {
  if (running) return false;
  opts = options;

  // ── Permission request on macOS ───────────────────────────────────────────
  try {
    if ((window as any).electronAPI?.requestMicPermission) {
      await (window as any).electronAPI.requestMicPermission();
    }
  } catch {}

  let started = 0;

  // ── MIC channel (Candidate) ───────────────────────────────────────────────
  try {
    const constraints: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl:  false,
      sampleRate:       16000,
    };
    if (micDeviceId) (constraints as any).deviceId = { exact: micDeviceId };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
    micChannel = buildChannel(stream, "Mic (You)", "Candidate");
    started++;
  } catch (e) {
    console.error("[audio] mic start failed:", e);
    opts.onStatus("Mic access failed — check permissions", "error");
  }

  // ── SPEAKER / CAPTURE channel (Interviewer) ───────────────────────────────
  // Supports: Stereo Mix (Windows), HDMI Capture card, Loopback virtual audio
  if (spkrDeviceId) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: spkrDeviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl:  false,
          sampleRate:       16000,
        } as any,
        video: false,
      });
      spkrChannel = buildChannel(stream, "Speaker (Interviewer)", "Interviewer");
      started++;
    } catch (e) {
      console.error("[audio] speaker channel failed:", e);
      opts.onStatus("Speaker capture failed — use Stereo Mix or HDMI capture card", "error");
    }
  }

  if (started === 0) return false;

  running = true;
  const active: string[] = [];
  if (micChannel)  active.push("Mic");
  if (spkrChannel) active.push("Speaker");
  opts.onStatus(`🎙 Dual capture: ${active.join(" + ")} active`, "ok");
  return true;
}

// ── Build a single audio processing channel ───────────────────────────────────
function buildChannel(
  stream: MediaStream,
  label: string,
  speaker: "Interviewer" | "Candidate"
): AudioChannel {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
  const src = ctx.createMediaStreamSource(stream);
  // bufferSize 2048 = lower latency than 4096
  const processor = ctx.createScriptProcessor(2048, 1, 1);

  const mimeType = getSupportedMimeType();
  const recorder = new MediaRecorder(stream, { mimeType });
  const ch: AudioChannel = {
    stream, ctx, src, processor, recorder,
    chunks: [], vadState: "silent", silTimer: null, locked: false,
    label, speaker,
  };

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) ch.chunks.push(e.data);
  };
  recorder.start(200); // 200ms slices → fast VAD response

  src.connect(processor);
  // Connect to destination needed for ScriptProcessor to fire (Chrome bug)
  processor.connect(ctx.destination);

  const threshold = opts?.silenceThresholdDb ?? -50;

  processor.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    const db  = 20 * Math.log10(rms < 0.00001 ? 0.00001 : rms);

    if (db > threshold) {
      // Sound detected
      if (ch.vadState === "silent") {
        ch.vadState = "speaking";
        opts?.onStatus(`${label} speaking…`, "ok");
      } else if (ch.vadState === "ending") {
        // False positive — still speaking
        ch.vadState = "speaking";
        if (ch.silTimer) { clearTimeout(ch.silTimer); ch.silTimer = null; }
      }
    } else {
      // Silence
      if (ch.vadState === "speaking") {
        ch.vadState = "ending";
        ch.silTimer = setTimeout(() => {
          ch.vadState = "silent";
          ch.silTimer = null;
          flushChannel(ch);
        }, 1600); // 1.6s silence → flush
      }
    }
  };

  return ch;
}

// ── Flush audio → Whisper → AI ────────────────────────────────────────────────
async function flushChannel(ch: AudioChannel) {
  if (ch.locked || ch.chunks.length === 0) return;
  ch.locked = true;

  const mimeType = getSupportedMimeType();
  const blob = new Blob(ch.chunks.splice(0), { type: mimeType });
  if (blob.size < 800) { ch.locked = false; return; }

  opts?.onStatus(`Transcribing ${ch.label}…`, "busy");

  try {
    const text = await transcribeBlob(blob);
    if (text && text.trim().length > 3) {
      opts?.onTranscript(text.trim(), ch.speaker, true);
    }
  } catch (e) {
    console.error(`[audio] flush error (${ch.label}):`, e);
  }

  ch.locked = false;
  if (running) opts?.onStatus("🎙 Listening…", "ok");
}

// ── Transcribe via Whisper (Together AI) ─────────────────────────────────────
async function transcribeBlob(blob: Blob): Promise<string> {
  const key = opts?.togetherKey;
  if (!key) throw new Error("No Together AI key");

  const ext  = blob.type.includes("ogg") ? "ogg"
             : blob.type.includes("mp4") ? "mp4"
             : "webm";
  const fd = new FormData();
  fd.append("file", blob, `audio.${ext}`);
  fd.append("model", "openai/whisper-large-v3");
  fd.append("language", "en");
  fd.append("response_format", "json");

  const r = await fetch("https://api.together.xyz/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}` },
    body: fd,
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`Whisper HTTP ${r.status}: ${errText.slice(0, 100)}`);
  }
  const d = await r.json();
  return d.text || "";
}

// ── Stop all ──────────────────────────────────────────────────────────────────
export function stopDualCapture(): void {
  running = false;
  [micChannel, spkrChannel].forEach(ch => {
    if (!ch) return;
    if (ch.silTimer) { clearTimeout(ch.silTimer); ch.silTimer = null; }
    try { ch.processor.disconnect(); } catch {}
    try { ch.src.disconnect(); } catch {}
    try { ch.ctx.close(); } catch {}
    try { if (ch.recorder.state !== "inactive") ch.recorder.stop(); } catch {}
    ch.stream.getTracks().forEach(t => t.stop());
  });
  micChannel  = null;
  spkrChannel = null;
}

export function isDualCaptureRunning(): boolean { return running; }

// ── Helper: best supported MIME type ─────────────────────────────────────────
function getSupportedMimeType(): string {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

// ── Manual flush (for testing) ────────────────────────────────────────────────
export function manualFlush(): void {
  if (micChannel)  flushChannel(micChannel);
  if (spkrChannel) flushChannel(spkrChannel);
}
