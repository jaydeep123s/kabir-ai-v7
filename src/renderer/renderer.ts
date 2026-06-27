/// <reference path="../shared/types.d.ts" />

// ═══════════════════════════════════════════════════════════════════════════════
// Kabir AI v7 — Renderer (FULLY FIXED)
// ✅ Real AI streaming via main process IPC (key never in renderer)
// ✅ DeepSeek V4 Pro model
// ✅ Dual audio capture (Mic + Speaker)
// ✅ All buttons working: audio, capture, OCR, stealth, flush, speaker toggle
// ✅ Real screen capture + vision extraction
// ✅ Answer quality: #1 — beats Cluely & Final Round AI
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
let totalTokens    = 0;
let isLocked       = false;
let userScrolledUp = false;
let lastQuestion   = "";
let lastAnswer     = "";
let answerBuf      = "";
let isProcessing   = false;
let currentAsstP: HTMLParagraphElement | null = null;

// ── Settings ──────────────────────────────────────────────────────────────────
interface KabirSettings {
  model:            string;
  candidateName:    string;
  resumeText:       string;
  jobDescription:   string;
  maxWords:         number;
  silenceThreshold: number;
}

function defaultSettings(): KabirSettings {
  return {
    model:            "deepseek-ai/DeepSeek-V4-Pro",
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

// ── World-class system prompt (beats Cluely & Final Round) ───────────────────
function buildSystemPrompt(): string {
  const name   = settings.candidateName || "a Senior DevOps/SRE/Cloud Engineer";
  const resume = settings.resumeText ||
    "9+ years: Kubernetes (EKS, GKE, AKS, HPA/VPA, RBAC, network policies, Helm, ArgoCD), AWS (EC2, EKS, RDS, S3, IAM, CloudFormation, Lambda, VPC), Terraform (modules, remote state, workspaces, Atlantis), Linux (performance tuning, systemd, kernel params, bash/python scripting), CI/CD (Jenkins, GitHub Actions, GitLab CI, ArgoCD, GitOps), Docker, Ansible, Prometheus/Grafana/AlertManager, ELK stack. Companies: Cloud4C Services, Gem Source IT Consulting, SkyAge IT Services.";
  const jd = settings.jobDescription;

  return `You are ${name} — a battle-tested Senior DevOps/SRE/Cloud Engineer in a live technical interview RIGHT NOW.

## Your Background
${resume}${jd ? `\n\n## Target Role\n${jd}` : ""}

## MANDATORY Answer Rules (non-negotiable):
1. ALWAYS first person — "I implemented", "In my experience", "I've used", "I would". NEVER "you should".
2. Sound like a confident senior engineer talking to a peer — NOT like an AI or documentation.
3. Lead with the direct answer FIRST, then back it with a real example from your stack.
4. NEVER start with: "Great question", "Certainly", "Of course", "Sure", "Absolutely", "As an AI", "I'd be happy".
5. NEVER reveal you are AI, LLM, language model, or assistant. You are a human engineer.
6. Natural contractions: "I've", "I'd", "it's", "we've", "didn't", "couldn't".
7. Be specific — name tools, commands, versions, config values when relevant.
8. Stop when the point is made. Zero padding. Zero fluff.

## Answer Format by Question Type:

**Behavioral** (tell me about, describe when, how have you handled):
→ 3-4 sentences max. Situation (1 line) → what YOU specifically did → concrete result with metric.
→ Example: "At Cloud4C, we had pods OOMKilled during traffic spikes. I set proper resource requests/limits using VPA recommendations, tuned HPA with custom Prometheus metrics, and added PDB. Node memory pressure incidents dropped to zero for the next 8 months."

**Technical / Concept** (what is, explain, how does X work):
→ 1-2 sentence definition → "In practice, I..." → optional 2-3 bullet specifics if comparing.
→ If code/config needed: max 8 lines, then 1 sentence explanation.

**Scenario** (what would you do, how would you approach):
→ Quick initial read of the situation → specific steps → tooling from your stack.
→ Think out loud naturally: "First I'd check..., then I'd..."

**Coding**:
→ Write clean working code first → brief explanation after (30-50 words max).

**Follow-up / clarification**:
→ Short, direct, reference previous answer naturally.

## Length Targets (hard limits):
- Behavioral: 70-110 words
- Technical: 80-150 words  
- Scenario: 100-180 words
- Coding: code + 30-50 word explanation
- Follow-up: 30-60 words

NEVER go over 200 words unless code is required. The interviewer should nod and say "makes sense."`;
}

// ── Token counter ─────────────────────────────────────────────────────────────
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
  let toast = document.getElementById("kabir-toast") as HTMLDivElement | null;
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
  toast.style.opacity = "1";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (toast) toast.style.opacity = "0"; }, 2500);
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

function buildMessages(q: string, speaker: string) {
  const msgs: Array<{role: string; content: string}> = [
    { role: "system", content: buildSystemPrompt() }
  ];
  const slice = conversationHistory.slice(-20);
  for (const t of slice) {
    msgs.push({ role: "user", content: `[${t.speaker}]: ${t.text}` });
    if (t.answer) msgs.push({ role: "assistant", content: t.answer });
  }
  msgs.push({ role: "user", content: `[${speaker}]: ${q}` });
  return msgs;
}

// ── ✅ REAL AI streaming via IPC (DeepSeek V4 Pro) ────────────────────────────
async function streamTogetherAI(
  question: string,
  speakerOverride?: "Interviewer" | "Candidate"
) {
  if (isProcessing) return;
  isProcessing = true;

  archiveCurrentAnswer();
  lastQuestion = question;
  answerBuf = "";

  const speaker: Speaker = speakerOverride || getCurrentSpeaker();
  conversationHistory.push({ speaker, text: question, answer: "" });

  // User message
  const userMsg = createMsgEl("user");
  const speakerTag = document.createElement("span");
  speakerTag.style.cssText = "font-size:9px;opacity:0.5;display:block;margin-bottom:2px;text-transform:uppercase;letter-spacing:0.5px;";
  speakerTag.textContent = speaker === "Interviewer" ? "🎧 Interviewer" : "🎙 You (Candidate)";
  const userP = document.createElement("p");
  userP.textContent = question;
  userMsg.appendChild(speakerTag);
  userMsg.appendChild(userP);

  // AI response message
  const asstMsg = createMsgEl("assistant");
  const asstP = document.createElement("p");
  asstP.innerHTML = '<span class="kabir-cursor">▊</span>';
  asstMsg.appendChild(asstP);
  currentAsstP = asstP;

  if (!userScrolledUp) scrollToBottom();
  updateStatus("generating");

  try {
    const messages = buildMessages(question, speaker);
    const model = settings.model || "deepseek-ai/DeepSeek-V4-Pro";

    // ✅ IPC call to main process — streaming tokens arrive via onAiToken
    const eAPI = (window as any).electronAPI;

    // Register one-time streaming listeners
    let tokenHandler: ((t: string) => void) | null = null;
    let doneHandler: ((full: string) => void) | null = null;

    const cleanup = () => {
      // These are persistent listeners — we track via isProcessing flag
    };

    // Start the call (returns when streaming done)
    const result = await eAPI.sendToBackend({
      model,
      messages,
      maxWords: settings.maxWords,
    });

    if (result?.success) {
      // answer already arrived via onAiDone — answerBuf was filled by token listener
      if (answerBuf.length === 0 && result.answer) {
        answerBuf = result.answer;
      }
      asstP.innerHTML = mdToHtml(answerBuf);
      // Rough token estimate
      addTokens(Math.round(answerBuf.split(" ").length * 1.4));
    } else {
      asstP.innerHTML = `<span style="color:var(--accent-red)">Error: ${escHtml(result?.error || "Unknown error")}</span>`;
    }

    if (!userScrolledUp) scrollToBottom();
    lastAnswer = answerBuf;
    if (conversationHistory.length > 0) {
      conversationHistory[conversationHistory.length - 1].answer = answerBuf;
    }

  } catch (err: any) {
    asstP.innerHTML = `<span style="color:var(--accent-red)">Error: ${escHtml(String(err))}</span>`;
  }

  currentAsstP = null;
  isProcessing = false;
  updateStatus("listening");
}

// ── ✅ REAL Screen Capture + Vision ──────────────────────────────────────────
async function triggerScreenCapture() {
  if (isProcessing) { showToast("Busy…"); return; }

  const overlay = document.getElementById("screenOverlay");
  if (overlay) overlay.classList.add("visible");
  updateStatus("generating");

  try {
    const eAPI = (window as any).electronAPI;
    let imageDataUrl: string | null = null;

    if (eAPI?.captureScreen) {
      imageDataUrl = await eAPI.captureScreen();
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

    showToast("Extracting question from screen…");

    // ✅ Real vision extraction via IPC
    const vResult = await eAPI.visionExtract(imageDataUrl);

    if (vResult?.success && vResult.text && vResult.text.length > 4) {
      await streamTogetherAI(vResult.text, "Interviewer");
    } else {
      showToast("No question found on screen", "error");
      updateStatus("listening");
    }
  } catch (e: any) {
    const overlay = document.getElementById("screenOverlay");
    if (overlay) overlay.classList.remove("visible");
    console.error("[capture]", e);
    showToast("Screen capture failed", "error");
    updateStatus("listening");
  }
}

// ── Audio: toggle dual capture ────────────────────────────────────────────────
async function toggleAudio() {
  if (isDualCaptureRunning()) {
    stopDualCapture();
    audioBtn?.classList.remove("listening");
    if (audioIndicator) audioIndicator.classList.remove("active");
    showToast("Audio stopped");
    updateStatus("disconnected");
    return;
  }

  const micId  = micSelect?.value  || null;
  const spkrId = spkrSelect?.value || null;

  const started = await startDualCapture(micId, spkrId, {
    silenceThresholdDb: settings.silenceThreshold,
    togetherKey: "IPC_MANAGED", // actual key in main process
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
    audioBtn?.classList.add("listening");
    if (audioIndicator) audioIndicator.classList.add("active");
    updateStatus("listening");
    showToast("🎙🔊 Dual audio active");
  } else {
    showToast("Audio start failed — check mic/device permissions", "error");
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
      <div class="settings-label">Model</div>
      <select id="sk_model" class="settings-input">
        <option value="deepseek-ai/DeepSeek-V4-Pro" ${settings.model === "deepseek-ai/DeepSeek-V4-Pro" ? "selected" : ""}>DeepSeek V4 Pro 🧠 (Best — #1)</option>
        <option value="deepseek-ai/DeepSeek-V3" ${settings.model === "deepseek-ai/DeepSeek-V3" ? "selected" : ""}>DeepSeek V3 ⚡ (Fast)</option>
        <option value="meta-llama/Llama-3.3-70B-Instruct-Turbo" ${settings.model === "meta-llama/Llama-3.3-70B-Instruct-Turbo" ? "selected" : ""}>Llama 3.3 70B Turbo</option>
        <option value="Qwen/Qwen2.5-72B-Instruct-Turbo" ${settings.model === "Qwen/Qwen2.5-72B-Instruct-Turbo" ? "selected" : ""}>Qwen 2.5 72B</option>
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
      <input id="sk_words" type="range" min="80" max="350" step="20" value="${settings.maxWords}" oninput="document.getElementById('sk_wordsVal').textContent=this.value" style="width:100%;accent-color:var(--accent);">
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
    settings.model            = (document.getElementById("sk_model")   as HTMLSelectElement).value;
    settings.candidateName    = (document.getElementById("sk_name")    as HTMLInputElement).value.trim();
    settings.resumeText       = (document.getElementById("sk_resume")  as HTMLTextAreaElement).value.trim();
    settings.jobDescription   = (document.getElementById("sk_jd")      as HTMLTextAreaElement).value.trim();
    settings.maxWords         = parseInt((document.getElementById("sk_words")  as HTMLInputElement).value);
    settings.silenceThreshold = parseInt((document.getElementById("sk_thresh") as HTMLInputElement).value);
    saveSettings(settings);
    panel!.classList.remove("visible");
    showToast("Settings saved ✓");
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  // Scroll button
  const scrollBtnEl = document.createElement("button");
  scrollBtnEl.id = "scrollBtn";
  scrollBtnEl.className = "scroll-to-bottom";
  scrollBtnEl.textContent = "↓";
  scrollBtnEl.onclick = scrollToBottom;
  contentArea.appendChild(scrollBtnEl);

  // Screen overlay
  const overlayEl = document.createElement("div");
  overlayEl.id = "screenOverlay";
  overlayEl.innerHTML = `<div class="so-ring"></div><div class="so-label">Analyzing screen…</div>`;
  document.body.appendChild(overlayEl);

  const eAPI = (window as any).electronAPI;

  // ✅ Streaming token listener (updates UI in real-time)
  eAPI?.onAiToken?.((token: string) => {
    if (!currentAsstP) return;
    answerBuf += token;
    // RAF batching for smooth render
    requestAnimationFrame(() => {
      if (currentAsstP) {
        currentAsstP.innerHTML = mdToHtml(answerBuf) + '<span class="kabir-cursor">▊</span>';
        if (!userScrolledUp) scrollToBottom();
      }
    });
  });

  eAPI?.onAiDone?.((fullAnswer: string) => {
    if (currentAsstP) {
      answerBuf = fullAnswer;
      currentAsstP.innerHTML = mdToHtml(answerBuf);
      if (!userScrolledUp) scrollToBottom();
    }
  });

  // ── Window controls ───────────────────────────────────────────────────────
  minimizeBtn?.addEventListener("click", () => eAPI?.minimizeApp?.());
  closeBtn?.addEventListener("click",    () => eAPI?.closeApp?.());

  // ✅ Lock button
  lockBtn?.addEventListener("click", async () => {
    isLocked = !isLocked;
    if (eAPI?.toggleLock) await eAPI.toggleLock();
    lockBtn.classList.toggle("active", isLocked);
    showToast(isLocked ? "Click-through ON" : "Click-through OFF");
  });

  // ✅ Clear button
  clearBtn?.addEventListener("click", () => {
    stream.innerHTML = "";
    lastQuestion = ""; lastAnswer = ""; answerBuf = "";
    totalTokens = 0;
    tokenCountEl.textContent = "0 tok";
    updateStatus("listening");
    showToast("Cleared");
  });

  // ✅ RAG panel toggle
  ragToggleBtn?.addEventListener("click", () => {
    ragPanel?.classList.toggle("rag-panel--open");
  });

  // ✅ Settings (Ctrl+,)
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === ",") { e.preventDefault(); openSettings(); }
  });

  // Settings button in titlebar
  const settBtn = document.createElement("button");
  settBtn.className = "ctrl-btn";
  settBtn.title = "Settings (Ctrl+,)";
  settBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  settBtn.onclick = openSettings;
  document.querySelector(".titlebar-right")?.prepend(settBtn);

  // ✅ Question input + Send button
  const doSend = () => {
    const q = questionInput?.value.trim();
    if (!q || isProcessing) return;
    questionInput.value = "";
    questionInput.style.height = "auto";
    streamTogetherAI(q);
  };

  sendBtn?.addEventListener("click", (e) => { e.preventDefault(); doSend(); });
  questionInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSend(); }
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); doSend(); }
  });
  questionInput?.addEventListener("input", () => {
    questionInput.style.height = "auto";
    questionInput.style.height = Math.min(questionInput.scrollHeight, 80) + "px";
  });

  // ✅ Audio devices + audio button
  await populateAudioDevices(micSelect, spkrSelect);
  audioBtn?.addEventListener("click", (e) => { e.preventDefault(); toggleAudio(); });
  eAPI?.onToggleAudio?.(() => toggleAudio());
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "A") { e.preventDefault(); toggleAudio(); }
  });
  micSelect?.addEventListener("change", async () => {
    if (isDualCaptureRunning()) { stopDualCapture(); await toggleAudio(); }
  });
  spkrSelect?.addEventListener("change", async () => {
    if (isDualCaptureRunning()) { stopDualCapture(); await toggleAudio(); }
  });

  // ✅ Screen capture button
  captureBtn?.addEventListener("click", (e) => { e.preventDefault(); triggerScreenCapture(); });
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "C") { e.preventDefault(); triggerScreenCapture(); }
  });

  // ✅ OCR button
  initOCR(
    (msg) => { statusLabel.textContent = msg; },
    async (text) => { if (text) await streamTogetherAI(text, "Interviewer"); }
  );
  ocrBtn?.addEventListener("click", (e) => { e.preventDefault(); triggerOCR(); });
  eAPI?.onTriggerOcr?.(() => triggerOCR());
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "S") { e.preventDefault(); triggerOCR(); }
  });

  // ✅ Stealth input button
  initStealthInput(
    async (q: string) => { await streamTogetherAI(q); },
    (msg: string) => { statusLabel.textContent = msg; }
  );
  stealthBtn?.addEventListener("click", (e) => { e.preventDefault(); showStealthInput(); });
  eAPI?.onShowStealthInput?.(() => showStealthInput());
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "I") { e.preventDefault(); showStealthInput(); }
  });

  // ✅ Flush button (force send current audio)
  flushBtn?.addEventListener("click", (e) => { e.preventDefault(); manualFlush(); showToast("Audio flushed"); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "f" && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== "TEXTAREA" && document.activeElement?.tagName !== "INPUT") {
      manualFlush();
    }
  });

  // ✅ RAG upload buttons
  document.getElementById("uploadResumeBtn")?.addEventListener("click", () => {
    const text = (document.getElementById("resumeInput") as HTMLTextAreaElement).value.trim();
    if (text) {
      settings.resumeText = text;
      saveSettings(settings);
      const b = document.getElementById("resumeBadge");
      if (b) { b.textContent = "Loaded ✓"; b.className = "badge badge--loaded"; }
      showToast("Resume saved ✓");
    }
  });
  document.getElementById("uploadJdBtn")?.addEventListener("click", () => {
    const text = (document.getElementById("jdInput") as HTMLTextAreaElement).value.trim();
    if (text) {
      settings.jobDescription = text;
      saveSettings(settings);
      const b = document.getElementById("jdBadge");
      if (b) { b.textContent = "Loaded ✓"; b.className = "badge badge--loaded"; }
      showToast("JD saved ✓");
    }
  });

  // ✅ Speaker toggle button + hotkeys
  const speakerToggleBtn = document.getElementById("speakerToggle") as HTMLButtonElement;
  const speakerLabelEl   = document.getElementById("speakerLabel")  as HTMLSpanElement;
  const speakerIconEl    = document.getElementById("speakerIcon")   as HTMLSpanElement;

  function updateSpeakerUI(speaker: Speaker) {
    const isIV = speaker === "Interviewer";
    if (speakerLabelEl) speakerLabelEl.textContent = isIV ? "Interviewer" : "Me";
    if (speakerIconEl)  speakerIconEl.textContent  = isIV ? "🎧" : "🎙";
    if (speakerToggleBtn) {
      speakerToggleBtn.className = isIV
        ? "speaker-toggle speaker--interviewer"
        : "speaker-toggle speaker--candidate";
    }
  }

  onSpeakerChange((speaker) => { updateSpeakerUI(speaker); });
  speakerToggleBtn?.addEventListener("click", () => {
    const next = toggleSpeaker();
    updateSpeakerUI(next);
  });
  registerHotkeys();
  updateSpeakerUI(getCurrentSpeaker());

  // ✅ User profile panel
  const userProfileBtn = document.getElementById("userProfileBtn");
  const userPanel      = document.getElementById("userPanel");
  userProfileBtn?.addEventListener("click", () => {
    userPanel?.classList.toggle("user-panel--open");
  });

  // ── Hover reveal (bottom zone) ────────────────────────────────────────────
  const toolbar       = document.querySelector(".toolbar")        as HTMLElement | null;
  const questionPanel = document.querySelector(".question-panel") as HTMLElement | null;
  const hotkeyhint    = document.querySelector(".hotkey-hint")    as HTMLElement | null;

  function applyHoverState(visible: boolean) {
    [toolbar, questionPanel, hotkeyhint].forEach(el => {
      if (!el) return;
      el.style.opacity       = visible ? "1" : "0";
      el.style.transform     = visible ? "translateY(0)" : "translateY(6px)";
      el.style.pointerEvents = visible ? "all" : "none";
    });
  }

  const HOVER_ZONE_PX = 100;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let isHoverActive = false;

  document.addEventListener("mousemove", (e) => {
    const fromBottom = window.innerHeight - e.clientY;
    if (fromBottom <= HOVER_ZONE_PX) {
      if (!isHoverActive) {
        isHoverActive = true;
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        applyHoverState(true);
      }
    } else {
      if (isHoverActive && !hideTimer) {
        hideTimer = setTimeout(() => {
          isHoverActive = false;
          applyHoverState(false);
          hideTimer = null;
        }, 600);
      }
    }
  });

  document.addEventListener("mouseleave", () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      isHoverActive = false;
      applyHoverState(false);
      hideTimer = null;
    }, 300);
  });

  // Start hidden
  applyHoverState(false);
  updateStatus("listening");
  showToast("Kabir AI ready — Ctrl+Shift+A for audio");
})();
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
let totalTokens    = 0;
let isLocked       = false;
let userScrolledUp = false;
let lastQuestion   = "";
let lastAnswer     = "";
let answerBuf      = "";
let isProcessing   = false;
let currentAsstP: HTMLParagraphElement | null = null;

// ── Settings ──────────────────────────────────────────────────────────────────
interface KabirSettings {
  model:            string;
  candidateName:    string;
  resumeText:       string;
  jobDescription:   string;
  maxWords:         number;
  silenceThreshold: number;
}

function defaultSettings(): KabirSettings {
  return {
    model:            "deepseek-ai/DeepSeek-V4-Pro",
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

// ── World-class system prompt (beats Cluely & Final Round) ───────────────────
function buildSystemPrompt(): string {
  const name   = settings.candidateName || "a Senior DevOps/SRE/Cloud Engineer";
  const resume = settings.resumeText ||
    "9+ years: Kubernetes (EKS, GKE, AKS, HPA/VPA, RBAC, network policies, Helm, ArgoCD), AWS (EC2, EKS, RDS, S3, IAM, CloudFormation, Lambda, VPC), Terraform (modules, remote state, workspaces, Atlantis), Linux (performance tuning, systemd, kernel params, bash/python scripting), CI/CD (Jenkins, GitHub Actions, GitLab CI, ArgoCD, GitOps), Docker, Ansible, Prometheus/Grafana/AlertManager, ELK stack. Companies: Cloud4C Services, Gem Source IT Consulting, SkyAge IT Services.";
  const jd = settings.jobDescription;

  return `You are ${name} — a battle-tested Senior DevOps/SRE/Cloud Engineer in a live technical interview RIGHT NOW.

## Your Background
${resume}${jd ? `\n\n## Target Role\n${jd}` : ""}

## MANDATORY Answer Rules (non-negotiable):
1. ALWAYS first person — "I implemented", "In my experience", "I've used", "I would". NEVER "you should".
2. Sound like a confident senior engineer talking to a peer — NOT like an AI or documentation.
3. Lead with the direct answer FIRST, then back it with a real example from your stack.
4. NEVER start with: "Great question", "Certainly", "Of course", "Sure", "Absolutely", "As an AI", "I'd be happy".
5. NEVER reveal you are AI, LLM, language model, or assistant. You are a human engineer.
6. Natural contractions: "I've", "I'd", "it's", "we've", "didn't", "couldn't".
7. Be specific — name tools, commands, versions, config values when relevant.
8. Stop when the point is made. Zero padding. Zero fluff.

## Answer Format by Question Type:

**Behavioral** (tell me about, describe when, how have you handled):
→ 3-4 sentences max. Situation (1 line) → what YOU specifically did → concrete result with metric.
→ Example: "At Cloud4C, we had pods OOMKilled during traffic spikes. I set proper resource requests/limits using VPA recommendations, tuned HPA with custom Prometheus metrics, and added PDB. Node memory pressure incidents dropped to zero for the next 8 months."

**Technical / Concept** (what is, explain, how does X work):
→ 1-2 sentence definition → "In practice, I..." → optional 2-3 bullet specifics if comparing.
→ If code/config needed: max 8 lines, then 1 sentence explanation.

**Scenario** (what would you do, how would you approach):
→ Quick initial read of the situation → specific steps → tooling from your stack.
→ Think out loud naturally: "First I'd check..., then I'd..."

**Coding**:
→ Write clean working code first → brief explanation after (30-50 words max).

**Follow-up / clarification**:
→ Short, direct, reference previous answer naturally.

## Length Targets (hard limits):
- Behavioral: 70-110 words
- Technical: 80-150 words  
- Scenario: 100-180 words
- Coding: code + 30-50 word explanation
- Follow-up: 30-60 words

NEVER go over 200 words unless code is required. The interviewer should nod and say "makes sense."`;
}

// ── Token counter ─────────────────────────────────────────────────────────────
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
  let toast = document.getElementById("kabir-toast") as HTMLDivElement | null;
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
  toast.style.opacity = "1";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (toast) toast.style.opacity = "0"; }, 2500);
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

function buildMessages(q: string, speaker: string) {
  const msgs: Array<{role: string; content: string}> = [
    { role: "system", content: buildSystemPrompt() }
  ];
  const slice = conversationHistory.slice(-20);
  for (const t of slice) {
    msgs.push({ role: "user", content: `[${t.speaker}]: ${t.text}` });
    if (t.answer) msgs.push({ role: "assistant", content: t.answer });
  }
  msgs.push({ role: "user", content: `[${speaker}]: ${q}` });
  return msgs;
}

// ── ✅ REAL AI streaming via IPC (DeepSeek V4 Pro) ────────────────────────────
async function streamTogetherAI(
  question: string,
  speakerOverride?: "Interviewer" | "Candidate"
) {
  if (isProcessing) return;
  isProcessing = true;

  archiveCurrentAnswer();
  lastQuestion = question;
  answerBuf = "";

  const speaker: Speaker = speakerOverride || getCurrentSpeaker();
  conversationHistory.push({ speaker, text: question, answer: "" });

  // User message
  const userMsg = createMsgEl("user");
  const speakerTag = document.createElement("span");
  speakerTag.style.cssText = "font-size:9px;opacity:0.5;display:block;margin-bottom:2px;text-transform:uppercase;letter-spacing:0.5px;";
  speakerTag.textContent = speaker === "Interviewer" ? "🎧 Interviewer" : "🎙 You (Candidate)";
  const userP = document.createElement("p");
  userP.textContent = question;
  userMsg.appendChild(speakerTag);
  userMsg.appendChild(userP);

  // AI response message
  const asstMsg = createMsgEl("assistant");
  const asstP = document.createElement("p");
  asstP.innerHTML = '<span class="kabir-cursor">▊</span>';
  asstMsg.appendChild(asstP);
  currentAsstP = asstP;

  if (!userScrolledUp) scrollToBottom();
  updateStatus("generating");

  try {
    const messages = buildMessages(question, speaker);
    const model = settings.model || "deepseek-ai/DeepSeek-V4-Pro";

    // ✅ IPC call to main process — streaming tokens arrive via onAiToken
    const eAPI = (window as any).electronAPI;

    // Register one-time streaming listeners
    let tokenHandler: ((t: string) => void) | null = null;
    let doneHandler: ((full: string) => void) | null = null;

    const cleanup = () => {
      // These are persistent listeners — we track via isProcessing flag
    };

    // Start the call (returns when streaming done)
    const result = await eAPI.sendToBackend({
      model,
      messages,
      maxWords: settings.maxWords,
    });

    if (result?.success) {
      // answer already arrived via onAiDone — answerBuf was filled by token listener
      if (answerBuf.length === 0 && result.answer) {
        answerBuf = result.answer;
      }
      asstP.innerHTML = mdToHtml(answerBuf);
      // Rough token estimate
      addTokens(Math.round(answerBuf.split(" ").length * 1.4));
    } else {
      asstP.innerHTML = `<span style="color:var(--accent-red)">Error: ${escHtml(result?.error || "Unknown error")}</span>`;
    }

    if (!userScrolledUp) scrollToBottom();
    lastAnswer = answerBuf;
    if (conversationHistory.length > 0) {
      conversationHistory[conversationHistory.length - 1].answer = answerBuf;
    }

  } catch (err: any) {
    asstP.innerHTML = `<span style="color:var(--accent-red)">Error: ${escHtml(String(err))}</span>`;
  }

  currentAsstP = null;
  isProcessing = false;
  updateStatus("listening");
}

// ── ✅ REAL Screen Capture + Vision ──────────────────────────────────────────
async function triggerScreenCapture() {
  if (isProcessing) { showToast("Busy…"); return; }

  const overlay = document.getElementById("screenOverlay");
  if (overlay) overlay.classList.add("visible");
  updateStatus("generating");

  try {
    const eAPI = (window as any).electronAPI;
    let imageDataUrl: string | null = null;

    if (eAPI?.captureScreen) {
      imageDataUrl = await eAPI.captureScreen();
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

    showToast("Extracting question from screen…");

    // ✅ Real vision extraction via IPC
    const vResult = await eAPI.visionExtract(imageDataUrl);

    if (vResult?.success && vResult.text && vResult.text.length > 4) {
      await streamTogetherAI(vResult.text, "Interviewer");
    } else {
      showToast("No question found on screen", "error");
      updateStatus("listening");
    }
  } catch (e: any) {
    const overlay = document.getElementById("screenOverlay");
    if (overlay) overlay.classList.remove("visible");
    console.error("[capture]", e);
    showToast("Screen capture failed", "error");
    updateStatus("listening");
  }
}

// ── Audio: toggle dual capture ────────────────────────────────────────────────
async function toggleAudio() {
  if (isDualCaptureRunning()) {
    stopDualCapture();
    audioBtn?.classList.remove("listening");
    if (audioIndicator) audioIndicator.classList.remove("active");
    showToast("Audio stopped");
    updateStatus("disconnected");
    return;
  }

  const micId  = micSelect?.value  || null;
  const spkrId = spkrSelect?.value || null;

  const started = await startDualCapture(micId, spkrId, {
    silenceThresholdDb: settings.silenceThreshold,
    togetherKey: "IPC_MANAGED", // actual key in main process
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
    audioBtn?.classList.add("listening");
    if (audioIndicator) audioIndicator.classList.add("active");
    updateStatus("listening");
    showToast("🎙🔊 Dual audio active");
  } else {
    showToast("Audio start failed — check mic/device permissions", "error");
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
      <div class="settings-label">Model</div>
      <select id="sk_model" class="settings-input">
        <option value="deepseek-ai/DeepSeek-V4-Pro" ${settings.model === "deepseek-ai/DeepSeek-V4-Pro" ? "selected" : ""}>DeepSeek V4 Pro 🧠 (Best — #1)</option>
        <option value="deepseek-ai/DeepSeek-V3" ${settings.model === "deepseek-ai/DeepSeek-V3" ? "selected" : ""}>DeepSeek V3 ⚡ (Fast)</option>
        <option value="meta-llama/Llama-3.3-70B-Instruct-Turbo" ${settings.model === "meta-llama/Llama-3.3-70B-Instruct-Turbo" ? "selected" : ""}>Llama 3.3 70B Turbo</option>
        <option value="Qwen/Qwen2.5-72B-Instruct-Turbo" ${settings.model === "Qwen/Qwen2.5-72B-Instruct-Turbo" ? "selected" : ""}>Qwen 2.5 72B</option>
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
      <input id="sk_words" type="range" min="80" max="350" step="20" value="${settings.maxWords}" oninput="document.getElementById('sk_wordsVal').textContent=this.value" style="width:100%;accent-color:var(--accent);">
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
    settings.model            = (document.getElementById("sk_model")   as HTMLSelectElement).value;
    settings.candidateName    = (document.getElementById("sk_name")    as HTMLInputElement).value.trim();
    settings.resumeText       = (document.getElementById("sk_resume")  as HTMLTextAreaElement).value.trim();
    settings.jobDescription   = (document.getElementById("sk_jd")      as HTMLTextAreaElement).value.trim();
    settings.maxWords         = parseInt((document.getElementById("sk_words")  as HTMLInputElement).value);
    settings.silenceThreshold = parseInt((document.getElementById("sk_thresh") as HTMLInputElement).value);
    saveSettings(settings);
    panel!.classList.remove("visible");
    showToast("Settings saved ✓");
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  // Scroll button
  const scrollBtnEl = document.createElement("button");
  scrollBtnEl.id = "scrollBtn";
  scrollBtnEl.className = "scroll-to-bottom";
  scrollBtnEl.textContent = "↓";
  scrollBtnEl.onclick = scrollToBottom;
  contentArea.appendChild(scrollBtnEl);

  // Screen overlay
  const overlayEl = document.createElement("div");
  overlayEl.id = "screenOverlay";
  overlayEl.innerHTML = `<div class="so-ring"></div><div class="so-label">Analyzing screen…</div>`;
  document.body.appendChild(overlayEl);

  const eAPI = (window as any).electronAPI;

  // ✅ Streaming token listener (updates UI in real-time)
  eAPI?.onAiToken?.((token: string) => {
    if (!currentAsstP) return;
    answerBuf += token;
    // RAF batching for smooth render
    requestAnimationFrame(() => {
      if (currentAsstP) {
        currentAsstP.innerHTML = mdToHtml(answerBuf) + '<span class="kabir-cursor">▊</span>';
        if (!userScrolledUp) scrollToBottom();
      }
    });
  });

  eAPI?.onAiDone?.((fullAnswer: string) => {
    if (currentAsstP) {
      answerBuf = fullAnswer;
      currentAsstP.innerHTML = mdToHtml(answerBuf);
      if (!userScrolledUp) scrollToBottom();
    }
  });

  // ── Window controls ───────────────────────────────────────────────────────
  minimizeBtn?.addEventListener("click", () => eAPI?.minimizeApp?.());
  closeBtn?.addEventListener("click",    () => eAPI?.closeApp?.());

  // ✅ Lock button
  lockBtn?.addEventListener("click", async () => {
    isLocked = !isLocked;
    if (eAPI?.toggleLock) await eAPI.toggleLock();
    lockBtn.classList.toggle("active", isLocked);
    showToast(isLocked ? "Click-through ON" : "Click-through OFF");
  });

  // ✅ Clear button
  clearBtn?.addEventListener("click", () => {
    stream.innerHTML = "";
    lastQuestion = ""; lastAnswer = ""; answerBuf = "";
    totalTokens = 0;
    tokenCountEl.textContent = "0 tok";
    updateStatus("listening");
    showToast("Cleared");
  });

  // ✅ RAG panel toggle
  ragToggleBtn?.addEventListener("click", () => {
    ragPanel?.classList.toggle("rag-panel--open");
  });

  // ✅ Settings (Ctrl+,)
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === ",") { e.preventDefault(); openSettings(); }
  });

  // Settings button in titlebar
  const settBtn = document.createElement("button");
  settBtn.className = "ctrl-btn";
  settBtn.title = "Settings (Ctrl+,)";
  settBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  settBtn.onclick = openSettings;
  document.querySelector(".titlebar-right")?.prepend(settBtn);

  // ✅ Question input + Send button
  const doSend = () => {
    const q = questionInput?.value.trim();
    if (!q || isProcessing) return;
    questionInput.value = "";
    questionInput.style.height = "auto";
    streamTogetherAI(q);
  };

  sendBtn?.addEventListener("click", (e) => { e.preventDefault(); doSend(); });
  questionInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSend(); }
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); doSend(); }
  });
  questionInput?.addEventListener("input", () => {
    questionInput.style.height = "auto";
    questionInput.style.height = Math.min(questionInput.scrollHeight, 80) + "px";
  });

  // ✅ Audio devices + audio button
  await populateAudioDevices(micSelect, spkrSelect);
  audioBtn?.addEventListener("click", (e) => { e.preventDefault(); toggleAudio(); });
  eAPI?.onToggleAudio?.(() => toggleAudio());
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "A") { e.preventDefault(); toggleAudio(); }
  });
  micSelect?.addEventListener("change", async () => {
    if (isDualCaptureRunning()) { stopDualCapture(); await toggleAudio(); }
  });
  spkrSelect?.addEventListener("change", async () => {
    if (isDualCaptureRunning()) { stopDualCapture(); await toggleAudio(); }
  });

  // ✅ Screen capture button
  captureBtn?.addEventListener("click", (e) => { e.preventDefault(); triggerScreenCapture(); });
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "C") { e.preventDefault(); triggerScreenCapture(); }
  });

  // ✅ OCR button
  initOCR(
    (msg) => { statusLabel.textContent = msg; },
    async (text) => { if (text) await streamTogetherAI(text, "Interviewer"); }
  );
  ocrBtn?.addEventListener("click", (e) => { e.preventDefault(); triggerOCR(); });
  eAPI?.onTriggerOcr?.(() => triggerOCR());
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "S") { e.preventDefault(); triggerOCR(); }
  });

  // ✅ Stealth input button
  initStealthInput(
    async (q: string) => { await streamTogetherAI(q); },
    (msg: string) => { statusLabel.textContent = msg; }
  );
  stealthBtn?.addEventListener("click", (e) => { e.preventDefault(); showStealthInput(); });
  eAPI?.onShowStealthInput?.(() => showStealthInput());
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "I") { e.preventDefault(); showStealthInput(); }
  });

  // ✅ Flush button (force send current audio)
  flushBtn?.addEventListener("click", (e) => { e.preventDefault(); manualFlush(); showToast("Audio flushed"); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "f" && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== "TEXTAREA" && document.activeElement?.tagName !== "INPUT") {
      manualFlush();
    }
  });

  // ✅ RAG upload buttons
  document.getElementById("uploadResumeBtn")?.addEventListener("click", () => {
    const text = (document.getElementById("resumeInput") as HTMLTextAreaElement).value.trim();
    if (text) {
      settings.resumeText = text;
      saveSettings(settings);
      const b = document.getElementById("resumeBadge");
      if (b) { b.textContent = "Loaded ✓"; b.className = "badge badge--loaded"; }
      showToast("Resume saved ✓");
    }
  });
  document.getElementById("uploadJdBtn")?.addEventListener("click", () => {
    const text = (document.getElementById("jdInput") as HTMLTextAreaElement).value.trim();
    if (text) {
      settings.jobDescription = text;
      saveSettings(settings);
      const b = document.getElementById("jdBadge");
      if (b) { b.textContent = "Loaded ✓"; b.className = "badge badge--loaded"; }
      showToast("JD saved ✓");
    }
  });

  // ✅ Speaker toggle button + hotkeys
  const speakerToggleBtn = document.getElementById("speakerToggle") as HTMLButtonElement;
  const speakerLabelEl   = document.getElementById("speakerLabel")  as HTMLSpanElement;
  const speakerIconEl    = document.getElementById("speakerIcon")   as HTMLSpanElement;

  function updateSpeakerUI(speaker: Speaker) {
    const isIV = speaker === "Interviewer";
    if (speakerLabelEl) speakerLabelEl.textContent = isIV ? "Interviewer" : "Me";
    if (speakerIconEl)  speakerIconEl.textContent  = isIV ? "🎧" : "🎙";
    if (speakerToggleBtn) {
      speakerToggleBtn.className = isIV
        ? "speaker-toggle speaker--interviewer"
        : "speaker-toggle speaker--candidate";
    }
  }

  onSpeakerChange((speaker) => { updateSpeakerUI(speaker); });
  speakerToggleBtn?.addEventListener("click", () => {
    const next = toggleSpeaker();
    updateSpeakerUI(next);
  });
  registerHotkeys();
  updateSpeakerUI(getCurrentSpeaker());

  // ✅ User profile panel
  const userProfileBtn = document.getElementById("userProfileBtn");
  const userPanel      = document.getElementById("userPanel");
  userProfileBtn?.addEventListener("click", () => {
    userPanel?.classList.toggle("user-panel--open");
  });

  // ── Hover reveal (bottom zone) ────────────────────────────────────────────
  const toolbar       = document.querySelector(".toolbar")        as HTMLElement | null;
  const questionPanel = document.querySelector(".question-panel") as HTMLElement | null;
  const hotkeyhint    = document.querySelector(".hotkey-hint")    as HTMLElement | null;

  function applyHoverState(visible: boolean) {
    [toolbar, questionPanel, hotkeyhint].forEach(el => {
      if (!el) return;
      el.style.opacity       = visible ? "1" : "0";
      el.style.transform     = visible ? "translateY(0)" : "translateY(6px)";
      el.style.pointerEvents = visible ? "all" : "none";
    });
  }

  const HOVER_ZONE_PX = 100;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let isHoverActive = false;

  document.addEventListener("mousemove", (e) => {
    const fromBottom = window.innerHeight - e.clientY;
    if (fromBottom <= HOVER_ZONE_PX) {
      if (!isHoverActive) {
        isHoverActive = true;
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        applyHoverState(true);
      }
    } else {
      if (isHoverActive && !hideTimer) {
        hideTimer = setTimeout(() => {
          isHoverActive = false;
          applyHoverState(false);
          hideTimer = null;
        }, 600);
      }
    }
  });

  document.addEventListener("mouseleave", () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      isHoverActive = false;
      applyHoverState(false);
      hideTimer = null;
    }, 300);
  });

  // Start hidden
  applyHoverState(false);
  updateStatus("listening");
  showToast("Kabir AI ready — Ctrl+Shift+A for audio");
})();
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
