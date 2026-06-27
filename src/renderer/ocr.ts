/// <reference path="../shared/types.d.ts" />

/**
 * ocr.ts — Screen OCR with area-selector overlay.
 *
 * Flow:
 *  1. Main process captures a full-screen PNG via desktopCapturer (captureScreen IPC).
 *  2. We paint that PNG onto a full-screen canvas inside a transparent selector div.
 *  3. User drags a bounding box over the desired region.
 *  4. We crop that region from the canvas and run Tesseract.js on it.
 *  5. Extracted text is passed to the callback (→ askQuestion).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type StatusCallback = (msg: string, type?: "idle" | "busy" | "error") => void;
type TextCallback   = (text: string) => void;

// ── State ─────────────────────────────────────────────────────────────────────

let selectorEl:   HTMLDivElement   | null = null;
let canvasEl:     HTMLCanvasElement | null = null;
let selectionEl:  HTMLDivElement   | null = null;
let onStatus:     StatusCallback         = () => {};
let onTextReady:  TextCallback           = () => {};

// ── Public init ───────────────────────────────────────────────────────────────

export function initOCR(
  statusCb: StatusCallback,
  textCb: TextCallback
): void {
  onStatus    = statusCb;
  onTextReady = textCb;
}

// ── Trigger (called by hotkey or button) ─────────────────────────────────────

export async function triggerOCR(): Promise<void> {
  if (selectorEl) return; // already open

  onStatus("📸 Capturing screen…", "busy");

  const base64 = await window.electronAPI?.captureScreen();
  if (!base64) {
    onStatus("❌ Screen capture failed", "error");
    setTimeout(() => onStatus("", "idle"), 2500);
    return;
  }

  onStatus("🖱️ Drag to select area…", "busy");
  openSelector(base64);
}

// ── Selector overlay ──────────────────────────────────────────────────────────

function openSelector(base64: string): void {
  // Outer wrapper — covers the entire viewport
  selectorEl = document.createElement("div");
  selectorEl.id = "ocrSelector";
  Object.assign(selectorEl.style, {
    position:  "fixed",
    inset:     "0",
    zIndex:    "99999",
    cursor:    "crosshair",
    userSelect:"none",
  });

  // Full-screen canvas showing the screenshot
  canvasEl = document.createElement("canvas");
  Object.assign(canvasEl.style, {
    position: "absolute",
    inset:    "0",
    opacity:  "0.85",
  });
  selectorEl.appendChild(canvasEl);

  // Semi-transparent drag overlay label
  const label = document.createElement("div");
  Object.assign(label.style, {
    position:      "absolute",
    top:           "12px",
    left:          "50%",
    transform:     "translateX(-50%)",
    background:    "rgba(0,0,0,0.72)",
    color:         "#fff",
    padding:       "6px 18px",
    borderRadius:  "20px",
    fontSize:      "13px",
    fontFamily:    "system-ui,sans-serif",
    pointerEvents: "none",
    zIndex:        "2",
    letterSpacing: "0.02em",
  });
  label.textContent = "Drag to select area  •  ESC to cancel";
  selectorEl.appendChild(label);

  // Selection rectangle (the rubber-band box)
  selectionEl = document.createElement("div");
  selectionEl.id = "ocrSelectionRect";
  Object.assign(selectionEl.style, {
    position:     "absolute",
    border:       "2px solid #6ee7f7",
    background:   "rgba(110,231,247,0.10)",
    boxShadow:    "0 0 0 2000px rgba(0,0,0,0.35)",
    pointerEvents:"none",
    display:      "none",
    zIndex:       "3",
  });
  selectorEl.appendChild(selectionEl);

  document.body.appendChild(selectorEl);

  // Paint screenshot on canvas
  const img = new Image();
  img.onload = () => {
    const dpr = window.devicePixelRatio || 1;
    canvasEl!.width  = window.innerWidth  * dpr;
    canvasEl!.height = window.innerHeight * dpr;
    canvasEl!.style.width  = window.innerWidth  + "px";
    canvasEl!.style.height = window.innerHeight + "px";
    const ctx = canvasEl!.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.drawImage(img, 0, 0, window.innerWidth, window.innerHeight);
  };
  img.src = "data:image/png;base64," + base64;

  // Drag events
  let dragStart: { x: number; y: number } | null = null;

  const onMouseDown = (e: MouseEvent) => {
    dragStart = { x: e.clientX, y: e.clientY };
    if (selectionEl) selectionEl.style.display = "block";
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragStart || !selectionEl) return;
    const x = Math.min(e.clientX, dragStart.x);
    const y = Math.min(e.clientY, dragStart.y);
    const w = Math.abs(e.clientX - dragStart.x);
    const h = Math.abs(e.clientY - dragStart.y);
    Object.assign(selectionEl.style, {
      left:   x + "px",
      top:    y + "px",
      width:  w + "px",
      height: h + "px",
      boxShadow: `0 0 0 2000px rgba(0,0,0,0.35), inset 0 0 0 2px #6ee7f7`,
    });
  };

  const onMouseUp = (e: MouseEvent) => {
    if (!dragStart) return;
    const rect: Rect = {
      x: Math.min(e.clientX, dragStart.x),
      y: Math.min(e.clientY, dragStart.y),
      w: Math.abs(e.clientX - dragStart.x),
      h: Math.abs(e.clientY - dragStart.y),
    };
    cleanup();
    if (rect.w > 10 && rect.h > 10) {
      runOCR(rect);
    } else {
      onStatus("❌ Selection too small", "error");
      setTimeout(() => onStatus("", "idle"), 2000);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      cleanup();
      onStatus("", "idle");
    }
  };

  function cleanup() {
    selectorEl?.remove();
    selectorEl  = null;
    canvasEl    = null;
    selectionEl = null;
    document.removeEventListener("keydown", onKeyDown);
  }

  selectorEl.addEventListener("mousedown", onMouseDown);
  selectorEl.addEventListener("mousemove", onMouseMove);
  selectorEl.addEventListener("mouseup",   onMouseUp);
  document.addEventListener("keydown", onKeyDown);
}

// ── OCR execution ─────────────────────────────────────────────────────────────

async function runOCR(rect: Rect): Promise<void> {
  onStatus("🔍 OCR Reading…", "busy");

  try {
    // Recapture at full DPR for higher accuracy
    const base64 = await window.electronAPI?.captureScreen();
    if (!base64) throw new Error("Failed to capture screen for OCR");

    const img = await loadImage("data:image/png;base64," + base64);

    // Crop the selected region, accounting for DPR scaling
    const dpr    = window.devicePixelRatio || 1;
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width  = rect.w * dpr;
    cropCanvas.height = rect.h * dpr;
    const ctx = cropCanvas.getContext("2d")!;

    // Source coords in actual pixel space
    const srcX = rect.x * (img.naturalWidth  / window.innerWidth);
    const srcY = rect.y * (img.naturalHeight / window.innerHeight);
    const srcW = rect.w * (img.naturalWidth  / window.innerWidth);
    const srcH = rect.h * (img.naturalHeight / window.innerHeight);

    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, cropCanvas.width, cropCanvas.height);

    onStatus("⚙️ Processing Screen…", "busy");

    const Tesseract = (window as any).Tesseract;
    if (!Tesseract) throw new Error("Tesseract.js not loaded");

    const { data } = await Tesseract.recognize(cropCanvas, "eng", {
      logger: (m: { status: string; progress?: number }) => {
        if (m.status === "recognizing text" && m.progress !== undefined) {
          const pct = Math.round(m.progress * 100);
          onStatus(`⚙️ OCR ${pct}%…`, "busy");
        }
      },
    });

    const text = (data.text ?? "").trim();

    if (!text) {
      onStatus("⚠️ No text found in selection", "error");
      setTimeout(() => onStatus("", "idle"), 3000);
      return;
    }

    onStatus(`✓ Extracted ${text.split(/\s+/).length} words`, "idle");
    setTimeout(() => onStatus("", "idle"), 2000);
    onTextReady(text);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[OCR] error:", msg);
    onStatus("❌ OCR failed: " + msg, "error");
    setTimeout(() => onStatus("", "idle"), 3500);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src     = src;
  });
}
