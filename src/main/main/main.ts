import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  desktopCapturer,
} from "electron";
import * as path from "path";

let mainWindow: BrowserWindow | null = null;
let selectorWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isLocked = false;

// ─── Main overlay window ───────────────────────────────────────────────────────

function createWindow(): void {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 480,
    height: 600,
    x: screenWidth - 500,
    y: 60,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    minWidth: 340,
    minHeight: 200,
    skipTaskbar: false,
    hasShadow: true,
    vibrancy: "under-window",
    visualEffectState: "followWindow",
    backgroundMaterial: "acrylic",
    // Content protection: invisible during screen share/recording
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setContentProtection(true);
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  // ── IPC: window controls ──────────────────────────────────────────────────

  ipcMain.on("start-drag", () => {
    if (mainWindow && !isLocked) mainWindow.setMovable(true);
  });

  ipcMain.handle("toggle-lock", () => {
    isLocked = !isLocked;
    mainWindow?.setIgnoreMouseEvents(isLocked, { forward: true });
    return isLocked;
  });

  ipcMain.handle("get-lock-state", () => isLocked);
  ipcMain.on("close-app", () => app.quit());
  ipcMain.on("minimize-app", () => mainWindow?.minimize());

  ipcMain.on("resize-window", (_event, height: number) => {
    if (mainWindow) {
      const [w] = mainWindow.getSize();
      mainWindow.setSize(w, Math.min(Math.max(height, 200), 800), true);
    }
  });

  // ── IPC: OCR — capture full screen, send PNG to renderer ─────────────────

  ipcMain.handle("capture-screen", async () => {
    try {
      const { width, height } = screen.getPrimaryDisplay().bounds;
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width, height },
      });
      if (!sources.length) return null;
      // Return base64 PNG so renderer can draw it on canvas
      return sources[0].thumbnail.toPNG().toString("base64");
    } catch (e) {
      console.error("[capture-screen] error:", e);
      return null;
    }
  });

  // ── IPC: Stealth Input — focus/hide helper ────────────────────────────────

  ipcMain.on("focus-stealth-input", () => {
    mainWindow?.show();
    mainWindow?.focus();
    mainWindow?.webContents.send("show-stealth-input");
  });

  ipcMain.on("hide-stealth-input", () => {
    mainWindow?.webContents.send("hide-stealth-input");
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ─── System tray ──────────────────────────────────────────────────────────────

function createTray(): void {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Kabir AI");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show / Hide",
        click: () => {
          mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show();
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ])
  );
}

// ─── Global shortcuts ─────────────────────────────────────────────────────────

function registerShortcuts(): void {
  // Toggle overlay visibility
  globalShortcut.register("CommandOrControl+Shift+O", () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus());
  });

  // Ctrl+Shift+S → trigger OCR area selector
  globalShortcut.register("CommandOrControl+Shift+S", () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.webContents.send("trigger-ocr");
  });

  // Ctrl+Shift+I → open stealth input field
  globalShortcut.register("CommandOrControl+Shift+I", () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("show-stealth-input");
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  createTray();
  registerShortcuts();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
