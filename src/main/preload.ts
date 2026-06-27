import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Window controls ───────────────────────────────────────────────────────
  toggleLock:    (): Promise<boolean>      => ipcRenderer.invoke("toggle-lock"),
  getLockState:  (): Promise<boolean>      => ipcRenderer.invoke("get-lock-state"),
  closeApp:      (): void                  => ipcRenderer.send("close-app"),
  minimizeApp:   (): void                  => ipcRenderer.send("minimize-app"),
  resizeWindow:  (h: number): void         => ipcRenderer.send("resize-window", h),
  startDrag:     (dx: number, dy: number)  => ipcRenderer.send("start-drag", dx, dy),

  // ── Screen capture ────────────────────────────────────────────────────────
  captureScreen: (): Promise<string | null> => ipcRenderer.invoke("capture-screen"),

  // ── Backend API Bridge (ZAROORI CHANGE: Key exposure ki jagah payload routing) ──
  sendToBackend: (payload: any): Promise<any> => ipcRenderer.invoke("send-to-backend", payload),

  // ── Stealth Input ─────────────────────────────────────────────────────────
  hideStealthInput: (): void => ipcRenderer.send("hide-stealth-input"),

  // ── Permissions ───────────────────────────────────────────────────────────
  requestMicPermission: (): Promise<boolean> => ipcRenderer.invoke("request-mic-permission"),

  // ── IPC listeners (main → renderer) ──────────────────────────────────────
  onTriggerOcr:       (cb: () => void) => ipcRenderer.on("trigger-ocr",        () => cb()),
  onShowStealthInput: (cb: () => void) => ipcRenderer.on("show-stealth-input",  () => cb()),
  onHideStealthInput: (cb: () => void) => ipcRenderer.on("hide-stealth-input",  () => cb()),
  onToggleAudio:      (cb: () => void) => ipcRenderer.on("toggle-audio",       () => cb()),
});