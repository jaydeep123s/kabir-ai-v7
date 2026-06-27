import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  globalShortcut,
  desktopCapturer,
  systemPreferences,
} from "electron";
import * as path from "path";
import * as fs from "fs";

// ZAROORI CHANGE 1: Hardware acceleration band (OBS/Discord hooks blocking active)
app.disableHardwareAcceleration();

// ── Load .env manually ────────────────────────────────────────────────────────
function loadEnv(): void {
  const envPath = path.join(app.getAppPath(), ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

let mainWindow: BrowserWindow | null = null;
let isLocked = false; // Shuruat me false taaki drag ho sake

// ─── Main overlay window ──────────────────────────────────────────────────────
function createWindow(): void {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    x: screenWidth - 500,
    y: 60,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    minWidth: 340,
    minHeight: 200,
    skipTaskbar: true, // Taskbar aur Alt+Tab se 100% hidden
    hasShadow: false,
    vibrancy: "under-window",
    visualEffectState: "followWindow",
    backgroundMaterial: "acrylic",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Title completely blank taaki process scan me window identity catch na ho
  mainWindow.setTitle("");

  // Screen recording, AnyDesk/TeamViewer black screen layer aur always on top logic
  mainWindow.setContentProtection(true);
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // ZAROORI CHANGE 2: Shuruat me click allow karein taaki remote ya mouse se drag ho sake
  mainWindow.setIgnoreMouseEvents(false);

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  // ── IPC: window controls & dragging ──────────────────────────────────────────
  ipcMain.on("start-drag", (_event, dx: number, dy: number) => {
    if (!mainWindow || isLocked) return;
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x + dx, y + dy);
  });

  ipcMain.handle("toggle-lock", () => {
    isLocked = !isLocked;
    // Lock dabate hi poori tarah click-through ho jayega
    mainWindow?.setIgnoreMouseEvents(isLocked, { forward: true });
    return isLocked;
  });

  ipcMain.handle("get-lock-state", () => isLocked);
  ipcMain.on("close-app", () => app.quit());
  ipcMain.on("minimize-app", () => mainWindow?.minimize());

  // ZAROORI CHANGE 3: Direct Key exposure band. Frontend sirf payload bhejega, response mock hoga.
  ipcMain.handle("send-to-backend", async (_event, payload: any) => {
    console.log("[Stealth Testing] Payload received:", payload);
    // 1.5 seconds ka fake delay network request simulate karne ke liye
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return {
      success: true,
      answer: "Frontend safely integrated. Mock response active.",
    };
  });

  ipcMain.on("resize-window", (_event, height: number) => {
    if (mainWindow) {
      const [w] = mainWindow.getSize();
      mainWindow.setSize(w, Math.min(Math.max(height, 200), 900), true);
    }
  });

  // ── IPC: Screen capture ───────────────────────────────────────────────────
  ipcMain.handle("capture-screen", async () => {
    try {
      const { width, height } = screen.getPrimaryDisplay().bounds;
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width, height },
      });
      if (!sources.length) return null;
      return "data:image/png;base64," + sources[0].thumbnail.toPNG().toString("base64");
    } catch (e) {
      console.error("[capture-screen] error:", e);
      return null;
    }
  });

  // ── IPC: Stealth Input ────────────────────────────────────────────────────
  ipcMain.on("focus-stealth-input", () => {
    mainWindow?.show();
    mainWindow?.focus();
    mainWindow?.setIgnoreMouseEvents(false);
    mainWindow?.webContents.send("show-stealth-input");
  });

  ipcMain.on("hide-stealth-input", () => {
    mainWindow?.setIgnoreMouseEvents(isLocked, { forward: true });
    mainWindow?.webContents.send("hide-stealth-input");
  });

  // ── IPC: Mic permission request (macOS) ───────────────────────────────────
  ipcMain.handle("request-mic-permission", async () => {
    if (process.platform === "darwin") {
      const status = systemPreferences.getMediaAccessStatus("microphone");
      if (status !== "granted") {
        return await systemPreferences.askForMediaAccess("microphone");
      }
    }
    return true;
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ZAROORI CHANGE 4: createTray() ko completely delete kar diya hai stealth safe karne ke liye.

// ─── Global shortcuts ─────────────────────────────────────────────────────────
function registerShortcuts(): void {
  globalShortcut.register("CommandOrControl+Shift+O", () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus());
  });

  globalShortcut.register("CommandOrControl+Shift+S", () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.webContents.send("trigger-ocr");
  });

  globalShortcut.register("CommandOrControl+Shift+I", () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.webContents.send("show-stealth-input");
  });

  globalShortcut.register("CommandOrControl+Shift+A", () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.webContents.send("toggle-audio");
  });

  globalShortcut.register("Escape", () => {
    mainWindow?.hide();
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  registerShortcuts();
  if (process.platform === "darwin") {
    app.dock?.hide(); // macOS Dock icon complete hide
  }
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});