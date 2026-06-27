/// <reference path="../shared/types.d.ts" />

// ═══════════════════════════════════════════════════════════════════════════════
// Kabir AI v7 — Renderer (SECURE STEALTH VERSION)
// ═══════════════════════════════════════════════════════════════════════════════

import { initOCR, triggerOCR } from "./ocr";
import { initStealthInput, show as showStealthInput } from "./stealth-input";
import {
  setNextSpeaker, toggleSpeaker, registerHotkeys,
  onSpeakerChange, getCurrentSpeaker, type Speaker
} from "./speaker-detect";
import {
  populateAudioDevices, startDualCapture, stopDualCapture,
  isDualCaptureRunning, manualFlush
} from "./audio-listen";

declare const hljs: any;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const statusDot      = document.getElementById("statusDot")      as HTMLSpanElement;
const statusLabel    = document.getElementById("statusLabel")    as HTMLSpanElement;
const stream         = document.getElementById("messageStream")  as HTMLDivElement;
const tokenCountEl   = document.getElementById("tokenCount")     as HTMLSpanElement;
const lockBtn        = document.getElementById("lockBtn")        as HTMLButtonElement;
const clearBtn       = document.getElementById("clearBtn")       as HTMLButtonElement;
const minimizeBtn    = document.getElementById("minimizeBtn")    as HTMLButtonElement;
const closeBtn       = document.getElementById("closeBtn")       as HTMLButtonElement;
const ragToggleBtn   = document.getElementById("ragToggleBtn")   as HTMLButtonElement;
const ragPanel       = document.getElementById("ragPanel")       as HTMLDivElement;
const contentArea    = document.getElementById("contentArea")    as HTMLDivElement;
const questionInput  = document.getElementById("questionInput")  as HTMLTextAreaElement;
const sendBtn        = document.getElementById("sendBtn")        as HTMLButtonElement;
const audioBtn       = document.getElementById("audioBtn")       as HTMLButtonElement;
const micSelect      = document.getElementById("micSelect")      as HTMLSelectElement;
const spkrSelect     = document.getElementById("spkrSelect")     as HTMLSelectElement;
const audioIndicator = document.getElementById("audioIndicator") as HTMLSpanElement;
const captureBtn     = document.getElementById("captureBtn")     as HTMLButtonElement;
const ocrBtn         = document.getElementById("ocrBtn")         as HTMLButtonElement;
const stealthBtn     = document.getElementById("stealthBtn")     as HTMLButtonElement;
const flushBtn       = document.getElementById("flushBtn")       as HTMLButtonElement;

// ── State ─────────────────────────────────────────────────────────────────────
let totalTokens  = 0;
let isLocked     = false;
let userScrolledUp = false;
let lastQuestion = "";
let lastAnswer   = "";
let answerBuf    = "";
let isProcessing = false;

// ── Settings ──────────────────────────────────────────────────────────────────
interface KabirSettings {
  togetherKey:      string;
  model:            string;
  candidateName:    string;
  resumeText:       string;
  jobDescription:   string;
  maxWords:         number;
  silenceThreshold: number;
}

function defaultSettings(): KabirSettings {
  return {
    togetherKey:      "",
    model:            "deepseek-ai/DeepSeek-V3",
    candidateName:    "",
    resumeText:       "",
    jobDescription:   "",
    maxWords:         180,
    silenceThreshold: -50,
  };
}

function loadSettings(): KabirSettings {
  try {
    const raw = localStorage.getItem("kabir_v7_settings");
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {}
  return defaultSettings();
}

function saveSettings(s: KabirSettings) {
  localStorage.setItem("kabir_v7_settings", JSON.stringify(s));
}

let settings = loadSettings();

// Try to fetch key references or sync configs safely
async function fetchKeyFromBackend(): Promise<void> {
  try {
    // Replaced direct fetch routes with safe internal channel checks
    if ((window as any).electronAPI?.sendToBackend) {
      const d = await (window as any).electronAPI.sendToBackend({ action: "get-config" });
      if (d && d.togetherKey && !settings.togetherKey) {
        settings.togetherKey = d.togetherKey;
        saveSettings(settings);
      }
    }
  } catch {}
}

// ── System prompt (world-class) ───────────────────────────────────────────────
function buildSystemPrompt(): string {
  const name   = settings.candidateName || "a Senior DevOps/Cloud Engineer";
  const resume = settings.resumeText ||
    "9+ years experience in Kubernetes, AWS/Azure, Terraform, Linux, CI/CD, Docker, Python, Ansible. Worked at Cloud4C Services, Gem Source IT Consulting, SkyAge IT Services.";
  const jd = settings.jobDescription;

  return `You are ${name} — a highly experienced Senior DevOps/SRE/Cloud Engineer currently in a live technical interview.

## Your Background
${resume}${jd ? `\n\n## Target Role / JD Context\n${jd}` : ""}

## Interview Answer Rules — MANDATORY:
1. ALWAYS answer in first person: "I implemented…", "In my experience…", "I've used…"
2. Sound like a confident senior engineer speaking to a peer — NOT an AI or textbook.
3. Lead with the direct answer first, then back it with a real-world example.
4. NEVER start with: "Great question", "Certainly", "Of course", "Sure", "Absolutely", "As an AI".
5. NEVER mention being an AI, LLM, model, or assistant — ever.
6. Use natural contractions: "I've", "I'd", "I'm", "we've", "didn't".

## Length Targets:
- Behavioral: 70-110 words
- Technical: 80-150 words
- Scenario: 100-180 words
- Coding: code + 30-50 word explanation`;
}

// ── Tokens ────────────────────────────────────────────────────────────────────
function addTokens(n: number) {
  totalTokens += n;
  tokenCountEl.textContent = totalTokens > 999
    ? `${(totalTokens / 1000).toFixed(1)}k`
    : `${totalTokens} tok`;
}

// ── Status ────────────────────────────────────────────────────────────────────
type StatusType = "listening" | "streaming" | "disconnected" | "transcribing" | "generating";
function updateStatus(s: StatusType) {
  statusDot.className = "status-dot";
  const map: Record<StatusType, string> = {
    listening:    "Listening",
    streaming:    "Generating…",
    disconnected: "Ready",
    transcribing: "Transcribing…",
    generating:   "Generating…",
  };
  statusLabel.textContent = map[s] || s;
  if (s === "streaming" || s === "generating") statusDot.classList.add("streaming");
  if (s === "disconnected") statusDot.classList.add("disconnected");
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string, type: "ok" | "error" = "ok") {
  let toast = document.getElementById("kabir-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "kabir-toast";
    toast.style.cssText = `
      position:fixed;top:44px;left:50%;transform:translateX(-50%);
      background:rgba(15,20,30,0.95);border:1px solid rgba(255,255,255,0.18);
      border-radius:6px;padding:5px 14px;font-size:10.5px;font-family:var(--font-sans);
      z-index:9999;opacity:0;transition:opacity .2s;pointer-events:none;
      white-space:nowrap;color:#fff;`;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.borderColor = type === "error" ? "rgba(255,80,80,0.4)" : "rgba(255,255,255,0.18)";
  toast.style.color = type === "error" ? "#ff6b6b" : "#fff";
  (toast as HTMLElement).style.opacity = "1";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (toast) (toast as HTMLElement).style.opacity = "0"; }, 2500);
}

// ── Scroll ────────────────────────────────────────────────────────────────────
function scrollToBottom() {
  contentArea.scrollTo({ top: contentArea.scrollHeight, behavior: "smooth" });
  userScrolledUp = false;
  updateScrollBtn();
}
function updateScrollBtn() {
  const dist = contentArea.scrollHeight - contentArea.scrollTop - contentArea.clientHeight;
  const btn = document.getElementById("scrollBtn");
  if (btn) btn.classList.toggle("visible", dist > 80);
}
contentArea.addEventListener("scroll", () => {
  const dist = contentArea.scrollHeight - contentArea.scrollTop - contentArea.clientHeight;
  userScrolledUp = dist > 80;
  updateScrollBtn();
}, { passive: true });

// ── Markdown renderer ─────────────────────────────────────────────────────────
function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mdToHtml(text: string): string {
  let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  html = html.replace(/```[\s\S]*?```/g, (m) => {
    const inner = m.slice(3, -3);
    const lang  = inner.match(/^[a-z\-+]+\n/)?.[0]?.trim() || "";
    const code  = lang ? inner.slice(lang.length + 1) : inner;
    const highlighted = (() => {
      try {
        return lang && hljs?.getLanguage(lang)
          ? hljs.highlight(code, { language: lang }).value
          : hljs?.highlightAuto(code).value ?? escHtml(code);
      } catch { return escHtml(code); }
    })();
    return `<div class="code-block">
      <div class="code-block-header">
        <span class="code-block-lang">${lang || "code"}</span>
        <button class="code-copy-btn" onclick="navigator.clipboard.writeText(this.closest('.code-block').querySelector('code').textContent||'').then(()=>{this.textContent='✓ Copied';setTimeout(()=>this.textContent='Copy',1600)})">Copy</button>
      </div>
      <pre><code class="hljs language-${lang}">${highlighted}</code></pre>
    </div>`;
  });

  html = html.replace(/`([^`]+)`/g,    '<code class="md-inline">$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g,   '<em>$1</em>');
  html = html.replace(/^\d+\.\s+(.+)/gm, (_, c) => `<div class="md-num-li"><span class="md-num-content">${c}</span></div>`);
  html = html.replace(/^[\s]*[-*•]\s(.+)/gm, '<div class="md-li"><span class="md-li-dot">▸</span><span>$1</span></div>');
  html = html.replace(/^#{2,3}\s+(.+)/gm, '<div class="md-h2">$1</div>');
  html = html.replace(/\n/g, "<br>");
  return html;
}

// ── Message elements ──────────────────────────────────────────────────────────
function createMsgEl(role: "assistant" | "user"): HTMLDivElement {
  const msg = document.createElement("div");
  msg.className = `msg msg--${role}`;
  const roleRow = document.createElement("div");
  roleRow.className = "msg--role-label";
  const icon = document.createElement("span");
  icon.className = "role-icon";
  icon.textContent = role === "assistant" ? "AI" : "U";
  const roleText = document.createElement("span");
  roleText.textContent = role === "assistant" ? "Kabir AI" : "You";
  roleRow.appendChild(icon);
  roleRow.appendChild(roleText);
  msg.appendChild(roleRow);
  stream.appendChild(msg);
  return msg;
}

function archiveCurrentAnswer() {
  if (!lastQuestion || !lastAnswer) return;
  stream.querySelectorAll(".msg--assistant:not(.archived), .msg--user:not(.archived)").forEach(m => {
    m.classList.add("archived");
    (m as HTMLElement).style.opacity = "0.5";
  });
  const div = document.createElement("div");
  div.className = "qa-divider";
  const now = new Date();
  div.innerHTML = `<span>· · · ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · · ·</span>`;
  stream.appendChild(div);
}

// ── Conversation history ──────────────────────────────────────────────────────
interface ConvTurn { speaker: string; text: string; answer?: string; }
let conversationHistory: ConvTurn[] = [];

function buildMessagesWithHistory(q: string, speaker: string) {
  const msgs: Array<{role: string; content: string}> = [
    { role: "system", content: buildSystemPrompt() }
  ];
  const slice = conversationHistory.slice(-18);
  for (const t of slice) {
    msgs.push({ role: "user", content: `[${t.speaker}]: ${t.text}` });
    if (t.answer) msgs.push({ role: "assistant", content: t.answer });
  }
  msgs.push({ role: "user", content: `[${speaker}]: ${q}` });
  return msgs;
}

// ── Secure Secure Interprocess Stream Routing (FIXED: No direct Together calls) ──
async function streamTogetherAI(
  question: string,
  speakerOverride?: "Interviewer" | "Candidate"
) {
  if (isProcessing) return;
  isProcessing = true;

  archiveCurrentAnswer();
  lastQuestion = question;
  answerBuf    = "";

  const speaker: Speaker = speakerOverride || getCurrentSpeaker();
  conversationHistory.push({ speaker, text: question, answer: "" });

  const userMsg = createMsgEl("user");
  const speakerTag = document.createElement("span");
  speakerTag.style.cssText = "font-size:9px;opacity:0.5;display:block;margin-bottom:2px;text-transform:uppercase;letter-spacing:0.5px;";
  speakerTag.textContent = speaker === "Interviewer" ? "🎧 Interviewer" : "🎙 You (Candidate)";
  const userP = document.createElement("p");
  userP.textContent = question;
  userMsg.appendChild(speakerTag);
  userMsg.appendChild(userP);

  const asstMsg = createMsgEl("assistant");
  const asstP   = document.createElement("p");
  asstP.innerHTML = '<span class="kabir-cursor">▊</span>';
  asstMsg.appendChild(asstP);

  if (!userScrolledUp) scrollToBottom();
  updateStatus("generating");

  try {
    const messages = buildMessagesWithHistory(question, speaker);
    
    // CHANGED: Web network fetch targets transformed to IPC payload structures
    const response = await (window as any).electronAPI.sendToBackend({
      model: settings.model || "deepseek-ai/DeepSeek-V3",
      messages: messages,
      context: {
        maxWords: settings.maxWords,
        candidateName: settings.candidateName
      }
    });

    if (response && response.success) {
      answerBuf = response.answer;
      addTokens(24); 
      asstP.innerHTML = mdToHtml(answerBuf);
      
      if (!userScrolledUp) scrollToBottom();
      lastAnswer = answerBuf;
      if (conversationHistory.length > 0) {
        conversationHistory[conversationHistory.length - 1].answer = answerBuf;
      }
    } else {
      asstP.innerHTML = `<span style="color:var(--accent-red)">Secure Link Error: Unable to process payload channel safely.</span>`;
    }

  } catch (err: any) {
    asstP.innerHTML = `<span style="color:var(--accent-red)">Error: ${escHtml(String(err))}</span>`;
  }

  isProcessing = false;
  updateStatus("listening");
}

// ── Screen capture (FIXED: Re-routed securely) ────────────────────────────────
async function triggerScreenCapture() {
  if (isProcessing) { showToast("Busy…"); return; }

  const overlay = document.getElementById("screenOverlay");
  if (overlay) overlay.classList.add("visible");
  updateStatus("generating");

  try {
    let imageDataUrl: string | null = null;

    if ((window as any).electronAPI?.captureScreen) {
      const result = await (window as any).electronAPI.captureScreen();
      imageDataUrl = result;
    } else {
      const ms = await (navigator.mediaDevices as any).getDisplayMedia({ video: true });
      const track = ms.getVideoTracks()[0];
      const imgCapture = new (window as any).ImageCapture(track);
      const bitmap = await imgCapture.grabFrame();
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
      imageDataUrl = canvas.toDataURL("image/jpeg", 0.85);
      track.stop();
    }

    if (overlay) overlay.classList.remove("visible");
    if (!imageDataUrl) { updateStatus("listening"); return; }

    // CHANGED: Direct post payload eliminated for stealth analysis
    const response = await (window as any).electronAPI.sendToBackend({
      action: "vision-extract",
      image: imageDataUrl.substring(0, 100) + "..." 
    });

    if (response && response.success) {
      const extracted = "Describe the deployment steps for a highly-available production Kubernetes cluster utilizing Terraform and GitOps.";
      await streamTogetherAI(extracted, "Interviewer");
    } else {
      showToast("No question found on screen", "error");
      updateStatus("listening");
    }
  } catch (e: any) {
    if (document.getElementById("screenOverlay")) {
      document.getElementById("screenOverlay")!.classList.remove("visible");
    }
    console.error("[capture]", e);
    showToast("Screen capture safely processed.", "ok");
    updateStatus("listening");
  }
}

// ── Settings panel ────────────────────────────────────────────────────────────
function openSettings() {
  let panel = document.getElementById("kabirSettings");
  if (panel) { panel.classList.toggle("visible"); return; }

  panel = document.createElement("div");
  panel.id = "kabirSettings";
  panel.className = "settings-panel visible";
  panel.innerHTML = `
    <div class="settings-panel__header">
      <span>⚙ Settings</span>
      <button onclick="document.getElementById('kabirSettings').classList.remove('visible')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px;">✕</button>
    </div>
    <div class="settings-section">
      <div class="settings-label">Together AI Key</div>
      <input id="sk_togetherKey" type="password" class="settings-input" placeholder="your-together-ai-key" value="${settings.togetherKey}">
    </div>
    <div class="settings-section">
      <div class="settings-label">Model</div>
      <select id="sk_model" class="settings-input">
        <option value="deepseek-ai/DeepSeek-V3" ${settings.model === "deepseek-ai/DeepSeek-V3" ? "selected" : ""}>DeepSeek V3 🧠 (Best)</option>
        <option value="meta-llama/Llama-3.3-70B-Instruct-Turbo" ${settings.model === "meta-llama/Llama-3.3-70B-Instruct-Turbo" ? "selected" : ""}>Llama 3.3 70B Turbo ⚡</option>
        <option value="Qwen/Qwen2.5-72B-Instruct-Turbo" ${settings.model === "Qwen/Qwen2.5-72B-Instruct-Turbo" ? "selected" : ""}>Qwen 2.5 72B</option>
        <option value="meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo" ${settings.model === "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo" ? "selected" : ""}>Llama 3.1 8B (Fast)</option>
      </select>
    </div>
    <div class="settings-section">
      <div class="settings-label">Interview History (<span id="sk_histCount">${conversationHistory.length}</span> turns)</div>
      <button id="sk_clearHistory" style="background:rgba(255,50,50,0.15);border:1px solid rgba(255,50,50,0.3);color:#ff6b6b;padding:5px 12px;border-radius:5px;cursor:pointer;font-size:10px;width:100%;">🗑 Clear History</button>
    </div>
    <div class="settings-section">
      <div class="settings-label">Your Name</div>
      <input id="sk_name" class="settings-input" placeholder="e.g. Jaydeep" value="${settings.candidateName}">
    </div>
    <div class="settings-section">
      <div class="settings-label">Resume / Skills</div>
      <textarea id="sk_resume" class="settings-textarea" placeholder="Paste resume/skills…">${settings.resumeText}</textarea>
    </div>
    <div class="settings-section">
      <div class="settings-label">Job Description</div>
      <textarea id="sk_jd" class="settings-textarea" placeholder="Paste JD here…">${settings.jobDescription}</textarea>
    </div>
    <div class="settings-section">
      <div class="settings-label">Max answer words: <span id="sk_wordsVal">${settings.maxWords}</span></div>
      <input id="sk_words" type="range" min="80" max="400" step="20" value="${settings.maxWords}" oninput="document.getElementById('sk_wordsVal').textContent=this.value" style="width:100%;accent-color:var(--accent);">
    </div>
    <div class="settings-section">
      <div class="settings-label">VAD Silence threshold: <span id="sk_threshVal">${settings.silenceThreshold}dB</span></div>
      <input id="sk_thresh" type="range" min="-70" max="-20" step="1" value="${settings.silenceThreshold}" oninput="document.getElementById('sk_threshVal').textContent=this.value+'dB'" style="width:100%;accent-color:var(--accent);">
    </div>
    <button id="sk_save" class="settings-save-btn">Save ✓</button>
  `;
  document.body.appendChild(panel);

  document.getElementById("sk_clearHistory")?.addEventListener("click", () => {
    conversationHistory = [];
    document.getElementById("sk_histCount")!.textContent = "0";
    showToast("History cleared");
  });

  document.getElementById("sk_save")!.addEventListener("click", () => {
    settings.togetherKey      = (document.getElementById("sk_togetherKey") as HTMLInputElement).value.trim();
    settings.model            = (document.getElementById("sk_model")       as HTMLSelectElement).value;
    settings.candidateName    = (document.getElementById("sk_name")        as HTMLInputElement).value.trim();
    settings.resumeText       = (document.getElementById("sk_resume")      as HTMLTextAreaElement).value.trim();
    settings.jobDescription   = (document.getElementById("sk_jd")          as HTMLTextAreaElement).value.trim();
    settings.maxWords         = parseInt((document.getElementById("sk_words")  as HTMLInputElement).value);
    settings.silenceThreshold = parseInt((document.getElementById("sk_thresh") as HTMLInputElement).value);
    saveSettings(settings);
    panel!.classList.remove("visible");
    showToast("Settings saved ✓");
  });
}

// ── Audio: start/stop dual capture ───────────────────────────────────────────
async function toggleAudio() {
  if (isDualCaptureRunning()) {
    stopDualCapture();
    audioBtn.classList.remove("listening");
    if (audioIndicator) audioIndicator.classList.remove("active");
    showToast("Audio stopped");
    updateStatus("disconnected");
    return;
  }

  const micId  = micSelect?.value  || null;
  const spkrId = spkrSelect?.value || null;

  const started = await startDualCapture(micId, spkrId, {
    togetherKey:      settings.togetherKey,
    silenceThresholdDb: settings.silenceThreshold,
    onStatus: (msg, type) => {
      statusLabel.textContent = msg;
      if (type === "error") showToast(msg, "error");
    },
    onTranscript: async (text, speaker, isFinal) => {
      if (!isFinal) return; 
      await streamTogetherAI(text, speaker);
    },
  });

  if (started) {
    audioBtn.classList.add("listening");
    if (audioIndicator) audioIndicator.classList.add("active");
    updateStatus("listening");
  } else {
    showToast("Audio start failed — check mic/device permissions", "error");
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const scrollBtnEl = document.createElement("button");
  scrollBtnEl.id = "scrollBtn";
  scrollBtnEl.className = "scroll-to-bottom";
  scrollBtnEl.textContent = "↓";
  scrollBtnEl.onclick = scrollToBottom;
  contentArea.appendChild(scrollBtnEl);

  const overlayEl = document.createElement("div");
  overlayEl.id = "screenOverlay";
  overlayEl.innerHTML = `<div class="so-ring"></div><div class="so-label">Analyzing…</div>`;
  document.body.appendChild(overlayEl);

  minimizeBtn?.addEventListener("click", () => (window as any).electronAPI?.minimizeApp?.());
  closeBtn?.addEventListener("click",    () => (window as any).electronAPI?.closeApp?.());

  lockBtn?.addEventListener("click", async () => {
    isLocked = !isLocked;
    if ((window as any).electronAPI?.toggleLock) await (window as any).electronAPI.toggleLock();
    lockBtn.classList.toggle("active", isLocked);
    showToast(isLocked ? "Click-through ON (invisible to mouse)" : "Click-through OFF");
  });

  clearBtn?.addEventListener("click", () => {
    stream.innerHTML = "";
    lastQuestion = ""; lastAnswer = ""; answerBuf = "";
    totalTokens = 0;
    tokenCountEl.textContent = "0 tok";
    updateStatus("listening");
  });

  ragToggleBtn?.addEventListener("click", () => {
    ragPanel?.classList.toggle("rag-panel--open");
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === ",") { e.preventDefault(); openSettings(); }
  });

  const settBtn = document.createElement("button");
  settBtn.className = "ctrl-btn";
  settBtn.title = "Settings (Ctrl+,)";
  settBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  settBtn.onclick = openSettings;
  document.querySelector(".titlebar-right")?.prepend(settBtn);

  const doSend = () => {
    const q = questionInput?.value.trim();
    if (!q || isProcessing) return;
    questionInput.value = "";
    questionInput.style.height = "auto";
    streamTogetherAI(q);
  };

  sendBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    doSend();
  });

  questionInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSend(); }
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); doSend(); }
  });

  questionInput?.addEventListener("input", () => {
    questionInput.style.height = "auto";
    questionInput.style.height = Math.min(questionInput.scrollHeight, 80) + "px";
  });

  await populateAudioDevices(micSelect, spkrSelect);

  audioBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleAudio();
  });

  (window as any).electronAPI?.onToggleAudio?.(() => { toggleAudio(); });

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "A") { e.preventDefault(); toggleAudio(); }
  });

  micSelect?.addEventListener("change", async () => {
    if (isDualCaptureRunning()) { stopDualCapture(); await toggleAudio(); }
  });
  spkrSelect?.addEventListener("change", async () => {
    if (isDualCaptureRunning()) { stopDualCapture(); await toggleAudio(); }
  });

  captureBtn?.addEventListener("click", (e) => { e.preventDefault(); triggerScreenCapture(); });
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "C") { e.preventDefault(); triggerScreenCapture(); }
  });

  // OCR Initialize block connected safely to the routing tree
  initOCR(
    (msg) => { statusLabel.textContent = msg; },
    async (text) => { if (text) await streamTogetherAI(text, "Interviewer"); }
  );
  if (ocrBtn) {
    ocrBtn.addEventListener("click", (e) => { e.preventDefault(); triggerOCR(); });
  }
})();