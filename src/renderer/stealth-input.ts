/// <reference path="../shared/types.d.ts" />

/**
 * stealth-input.ts — Invisible quick-question input field.
 *
 * Triggered by Ctrl+Shift+I (global shortcut in main.ts).
 * A slim, dark, frosted-glass input bar slides in at the bottom of the overlay.
 * User types / pastes → hits Enter → question fires to backend → bar disappears.
 */

type AskFn     = (question: string) => void;
type StatusFn  = (msg: string, type?: "idle" | "busy" | "error") => void;

let stealthEl:   HTMLDivElement   | null = null;
let inputEl:     HTMLInputElement | null = null;
let isVisible:   boolean                = false;

let onAsk:       AskFn    = () => {};
let onStatus:    StatusFn = () => {};

// ── Init ──────────────────────────────────────────────────────────────────────

export function initStealthInput(askFn: AskFn, statusFn: StatusFn): void {
  onAsk    = askFn;
  onStatus = statusFn;
  buildDOM();
  registerIPCListeners();
}

// ── DOM construction ──────────────────────────────────────────────────────────

function buildDOM(): void {
  stealthEl = document.createElement("div");
  stealthEl.id = "stealthInput";
  Object.assign(stealthEl.style, {
    display:       "none",
    position:      "fixed",
    bottom:        "12px",
    left:          "50%",
    transform:     "translateX(-50%)",
    zIndex:        "100000",
    width:         "90%",
    maxWidth:      "440px",
  });

  const wrapper = document.createElement("div");
  Object.assign(wrapper.style, {
    display:         "flex",
    alignItems:      "center",
    gap:             "8px",
    background:      "rgba(12,12,16,0.88)",
    border:          "1px solid rgba(110,231,247,0.30)",
    borderRadius:    "12px",
    padding:         "8px 12px",
    backdropFilter:  "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    boxShadow:       "0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(110,231,247,0.12)",
  });

  // Icon
  const icon = document.createElement("span");
  icon.textContent = "⌨";
  Object.assign(icon.style, {
    fontSize:  "16px",
    opacity:   "0.55",
    flexShrink:"0",
  });
  wrapper.appendChild(icon);

  // Text input
  inputEl = document.createElement("input");
  inputEl.type        = "text";
  inputEl.placeholder = "Type question & press Enter…";
  Object.assign(inputEl.style, {
    flex:        "1",
    background:  "transparent",
    border:      "none",
    outline:     "none",
    color:       "#e8e8f0",
    fontSize:    "13px",
    fontFamily:  "system-ui, -apple-system, sans-serif",
    letterSpacing:"0.01em",
  });

  // Hint badge
  const hint = document.createElement("span");
  hint.textContent = "ESC";
  Object.assign(hint.style, {
    fontSize:   "10px",
    color:      "rgba(255,255,255,0.28)",
    flexShrink: "0",
    fontFamily: "monospace",
    border:     "1px solid rgba(255,255,255,0.12)",
    padding:    "1px 5px",
    borderRadius:"4px",
  });

  wrapper.appendChild(inputEl);
  wrapper.appendChild(hint);
  stealthEl.appendChild(wrapper);
  document.body.appendChild(stealthEl);

  // Events
  inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      hide();
    }
  });

  // Click outside → hide
  document.addEventListener("mousedown", (e: MouseEvent) => {
    if (isVisible && stealthEl && !stealthEl.contains(e.target as Node)) {
      hide();
    }
  });
}

// ── IPC listeners ─────────────────────────────────────────────────────────────

function registerIPCListeners(): void {
  window.electronAPI?.onShowStealthInput(() => show());
  window.electronAPI?.onHideStealthInput(() => hide());
}

// ── Show / hide ───────────────────────────────────────────────────────────────

export function show(): void {
  if (!stealthEl || !inputEl) return;
  stealthEl.style.display = "block";
  isVisible = true;
  // Slide-in animation via keyframe
  stealthEl.animate(
    [
      { opacity: 0, transform: "translateX(-50%) translateY(12px)" },
      { opacity: 1, transform: "translateX(-50%) translateY(0)" },
    ],
    { duration: 180, easing: "ease-out", fill: "forwards" }
  );
  setTimeout(() => inputEl?.focus(), 80);
  onStatus("⌨️ Stealth input ready…", "idle");
}

export function hide(): void {
  if (!stealthEl || !inputEl) return;
  stealthEl.animate(
    [
      { opacity: 1, transform: "translateX(-50%) translateY(0)" },
      { opacity: 0, transform: "translateX(-50%) translateY(10px)" },
    ],
    { duration: 140, easing: "ease-in", fill: "forwards" }
  ).onfinish = () => {
    if (stealthEl) stealthEl.style.display = "none";
  };
  isVisible = false;
  inputEl.value = "";
  onStatus("", "idle");
}

// ── Submit ────────────────────────────────────────────────────────────────────

function submit(): void {
  const q = inputEl?.value.trim() ?? "";
  if (!q) { hide(); return; }
  onAsk(q);
  hide();
}
