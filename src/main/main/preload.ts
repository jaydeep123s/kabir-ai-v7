import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Window controls ───────────────────────────────────────────────────────
  toggleLock:   (): Promise<boolean>       => ipcRenderer.invoke("toggle-lock"),
  getLockState: (): Promise<boolean>       => ipcRenderer.invoke("get-lock-state"),
  closeApp:     (): void                   => ipcRenderer.send("close-app"),
  minimizeApp:  (): void                   => ipcRenderer.send("minimize-app"),
  resizeWindow: (h: number): void          => ipcRenderer.send("resize-window", h),
  startDrag:    (dx: number, dy: number)   => ipcRenderer.send("start-drag", dx, dy),

  // ── Screen capture ────────────────────────────────────────────────────────
  captureScreen: (): Promise<string | null> => ipcRenderer.invoke("capture-screen"),

  // ── AI (key never in renderer — goes through main process) ───────────────
  sendToBackend: (payload: any): Promise<any>       => ipcRenderer.invoke("send-to-backend", payload),
  visionExtract: (b64: string): Promise<any>        => ipcRenderer.invoke("vision-extract", b64),

  // ── Stealth Input ─────────────────────────────────────────────────────────
  hideStealthInput: (): void => ipcRenderer.send("hide-stealth-input"),

  // ── Permissions ───────────────────────────────────────────────────────────
  requestMicPermission: (): Promise<boolean> => ipcRenderer.invoke("request-mic-permission"),

  // ── Main → Renderer events ────────────────────────────────────────────────
  onTriggerOcr:       (cb: () => void)              => ipcRenderer.on("trigger-ocr",       () => cb()),
  onShowStealthInput: (cb: () => void)              => ipcRenderer.on("show-stealth-input", () => cb()),
  onHideStealthInput: (cb: () => void)              => ipcRenderer.on("hide-stealth-input", () => cb()),
  onToggleAudio:      (cb: () => void)              => ipcRenderer.on("toggle-audio",       () => cb()),

  // ── AI Streaming tokens (real-time) ──────────────────────────────────────
  onAiToken: (cb: (token: string) => void) => ipcRenderer.on("ai-token", (_e, t) => cb(t)),
  onAiDone:  (cb: (full: string) => void)  => ipcRenderer.on("ai-done",  (_e, a) => cb(a)),
});
