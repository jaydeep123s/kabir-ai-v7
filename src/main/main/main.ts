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
import * as https from "https";
import { spawn, ChildProcess } from "child_process";

// ✅ Hardware acceleration band — OBS/Discord hooks avoid
app.disableHardwareAcceleration();

// ── Load .env ─────────────────────────────────────────────────────────────────
function loadEnv(): void {
  // Check multiple locations: app folder, resources folder, exe folder
  const locations = [
    path.join(app.getAppPath(), ".env"),
    path.join(process.resourcesPath || "", ".env"),
    path.join(path.dirname(app.getPath("exe")), ".env"),
  ];
  for (const envPath of locations) {
    if (!fs.existsSync(envPath)) continue;
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
    break;
  }
}
loadEnv();

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let isLocked = false;

// ── Backend auto-spawn ────────────────────────────────────────────────────────
function startBackend(): void {
  // Backend binary location: resources/backend/backend.exe (bundled)
  // Or: ../kabirai--backend/backend.exe (dev mode)
  const isProd = app.isPackaged;

  const backendPaths = isProd
    ? [
        path.join(process.resourcesPath, "backend", "backend.exe"),
        path.join(process.resourcesPath, "backend", "backend"),
      ]
    : [
        path.join(__dirname, "../../..", "..", "kabirai--backend", "backend.exe"),
        path.join(__dirname, "../../..", "..", "kabirai--backend", "backend"),
      ];

  const backendExe = backendPaths.find(p => fs.existsSync(p));
  if (!backendExe) {
    console.log("[backend] Binary not found — skipping backend spawn (direct API mode)");
    return;
  }

  console.log("[backend] Starting:", backendExe);
  backendProcess = spawn(backendExe, [], {
    detached: false,
    windowsHide: true,
    env: { ...process.env },
  });

  backendProcess.stdout?.on("data", (d: Buffer) => console.log("[backend]", d.toString().trim()));
  backendProcess.stderr?.on("data", (d: Buffer) => console.error("[backend]", d.toString().trim()));
  backendProcess.on("exit", (code) => console.log("[backend] exited with code", code));
}

function stopBackend(): void {
  if (backendProcess) {
    try { backendProcess.kill(); } catch {}
    backendProcess = null;
  }
}

// ── Real Together AI streaming (main process — key never goes to renderer) ────
function streamTogetherAI(
  payload: { model: string; messages: any[]; maxWords?: number },
  senderEvent: Electron.IpcMainInvokeEvent
): Promise<{ success: boolean; answer?: string; error?: string }> {
  return new Promise((resolve) => {
    const key = process.env.TOGETHER_AI_API_KEY || process.env.TOGETHER_API_KEY || "";
    if (!key) {
      resolve({ success: false, error: "TOGETHER_AI_API_KEY not set in .env file" });
      return;
    }

    const model    = payload.model || "deepseek-ai/DeepSeek-V4-Pro";
    const maxWords = payload.maxWords || 200;
    const maxTokens = Math.min(Math.round(maxWords * 1.5), 900);

    const body = JSON.stringify({
      model,
      messages:    payload.messages,
      stream:      true,
      max_tokens:  maxTokens,
      temperature: 0.55,
      top_p:       0.92,
    });

    const req = https.request(
      {
        hostname: "api.together.xyz",
        path:     "/v1/chat/completions",
        method:   "POST",
        headers: {
          Authorization:  `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept:         "text/event-stream",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          let errBody = "";
          res.on("data", (c: Buffer) => { errBody += c.toString(); });
          res.on("end", () => {
            resolve({ success: false, error: `HTTP ${res.statusCode}: ${errBody.slice(0, 200)}` });
          });
          return;
        }

        let fullAnswer = "";
        let buffer     = "";

        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf-8");
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              const token  = parsed?.choices?.[0]?.delta?.content || "";
              if (token) {
                fullAnswer += token;
                // Send token to renderer immediately
                try { senderEvent.sender.send("ai-token", token); } catch {}
              }
            } catch {}
          }
        });

        res.on("end", () => {
          try { senderEvent.sender.send("ai-done", fullAnswer); } catch {}
          resolve({ success: true, answer: fullAnswer });
        });

        res.on("error", (err: Error) => {
          resolve({ success: false, error: err.message });
        });
      }
    );

    req.on("error", (err: Error) => {
      resolve({ success: false, error: err.message });
    });

    req.write(body);
    req.end();
  });
}

// ── Vision: Extract question from screenshot ──────────────────────────────────
function visionExtract(
  imageB64: string
): Promise<{ success: boolean; text?: string; error?: string }> {
  return new Promise((resolve) => {
    const key = process.env.TOGETHER_AI_API_KEY || process.env.TOGETHER_API_KEY || "";
    if (!key) { resolve({ success: false, error: "No API key" }); return; }

    const b64  = imageB64.replace(/^data:image\/[a-z]+;base64,/, "");
    const body = JSON.stringify({
      model:      "meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Extract the interview question, coding problem, or technical task visible in this screenshot. Include any code shown. If nothing found, return: NONE. Return only extracted text, nothing else." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } }
        ]
      }]
    });

    const req = https.request({
      hostname: "api.together.xyz",
      path:     "/v1/chat/completions",
      method:   "POST",
      headers:  {
        Authorization:  `Bearer ${key}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      }
    }, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => { data += c; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const text   = (parsed?.choices?.[0]?.message?.content || "").trim();
          resolve({ success: true, text: text === "NONE" ? "" : text });
        } catch {
          resolve({ success: false, error: "Parse error" });
        }
      });
    });
    req.on("error", (e: Error) => resolve({ success: false, error: e.message }));
    req.write(body);
    req.end();
  });
}

// ─── Main overlay window ──────────────────────────────────────────────────────
function createWindow(): void {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width:     480,
    height:    640,
    x:         screenWidth - 500,
    y:         60,
    frame:     false,
    transparent: true,
    alwaysOnTop: true,
    resizable:   true,
    minWidth:    340,
    minHeight:   200,
    // ✅ 100% invisible — taskbar + Alt+Tab se bhi nahi dikhega
    skipTaskbar: true,
    hasShadow:   false,
    vibrancy:    "under-window",
    visualEffectState: "followWindow",
    backgroundMaterial: "acrylic",
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  // ✅ Title blank — process scanner se identity hide
  mainWindow.setTitle("");

  // ✅ OBS, Zoom, AnyDesk, TeamViewer — sab mein black/invisible
  mainWindow.setContentProtection(true);

  // ✅ Sabse upar — fullscreen apps ke bhi upar
  mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  // ── IPC handlers ──────────────────────────────────────────────────────────

  ipcMain.on("start-drag", (_e, dx: number, dy: number) => {
    if (!mainWindow || isLocked) return;
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x + dx, y + dy);
  });

  ipcMain.handle("toggle-lock", () => {
    isLocked = !isLocked;
    mainWindow?.setIgnoreMouseEvents(isLocked, { forward: true });
    return isLocked;
  });

  ipcMain.handle("get-lock-state", () => isLocked);

  ipcMain.on("close-app",    () => { mainWindow?.destroy(); app.quit(); });
  ipcMain.on("minimize-app", () => mainWindow?.minimize());

  ipcMain.on("resize-window", (_e, height: number) => {
    if (mainWindow) {
      const [w] = mainWindow.getSize();
      mainWindow.setSize(w, Math.min(Math.max(height, 200), 900), true);
    }
  });

  // ✅ Real AI streaming
  ipcMain.handle("send-to-backend", async (event, payload: any) => {
    return await streamTogetherAI(payload, event);
  });

  // ✅ Real vision extraction
  ipcMain.handle("vision-extract", async (_e, imageB64: string) => {
    return await visionExtract(imageB64);
  });

  // ── Screen capture ────────────────────────────────────────────────────────
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
      console.error("[capture-screen]", e);
      return null;
    }
  });

  // ── Stealth Input ─────────────────────────────────────────────────────────
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

  // ── Mic permission (macOS) ────────────────────────────────────────────────
  ipcMain.handle("request-mic-permission", async () => {
    if (process.platform === "darwin") {
      const status = systemPreferences.getMediaAccessStatus("microphone");
      if (status !== "granted") return await systemPreferences.askForMediaAccess("microphone");
    }
    return true;
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ─── Global shortcuts ─────────────────────────────────────────────────────────
function registerShortcuts(): void {
  // Show/hide overlay
  globalShortcut.register("CommandOrControl+Shift+O", () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus());
  });
  // OCR
  globalShortcut.register("CommandOrControl+Shift+S", () => {
    mainWindow?.show();
    mainWindow?.webContents.send("trigger-ocr");
  });
  // Stealth input
  globalShortcut.register("CommandOrControl+Shift+I", () => {
    mainWindow?.show();
    mainWindow?.focus();
    mainWindow?.setIgnoreMouseEvents(false);
    mainWindow?.webContents.send("show-stealth-input");
  });
  // Audio toggle
  globalShortcut.register("CommandOrControl+Shift+A", () => {
    mainWindow?.show();
    mainWindow?.webContents.send("toggle-audio");
  });
  // Panic hide
  globalShortcut.register("Escape", () => mainWindow?.hide());
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  startBackend();
  createWindow();
  registerShortcuts();
  if (process.platform === "darwin") app.dock?.hide();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopBackend();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
        hostname: "api.together.xyz",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let fullAnswer = "";
        let buffer = "";

        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf-8");
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              const token = parsed?.choices?.[0]?.delta?.content || "";
              if (token) {
                fullAnswer += token;
                // Send token to renderer immediately (streaming)
                try {
                  event.sender.send("ai-token", token);
                } catch {}
              }
              const finish = parsed?.choices?.[0]?.finish_reason;
              if (finish && finish !== "null") {
                // done
              }
            } catch {}
          }
        });

        res.on("end", () => {
          event.sender.send("ai-done", fullAnswer);
          resolve({ success: true, answer: fullAnswer });
        });

        res.on("error", (err: Error) => {
          resolve({ success: false, error: err.message });
        });

        if (res.statusCode && res.statusCode !== 200) {
          let errBody = "";
          res.on("data", (c: Buffer) => { errBody += c.toString(); });
          res.on("end", () => {
            resolve({ success: false, error: `HTTP ${res.statusCode}: ${errBody.slice(0, 200)}` });
          });
        }
      }
    );

    req.on("error", (err: Error) => {
      resolve({ success: false, error: err.message });
    });

    req.write(body);
    req.end();
  });
}

// ── Vision: Extract question from screenshot ──────────────────────────────────
function extractFromScreenshot(
  imageB64: string
): Promise<{ success: boolean; text?: string; error?: string }> {
  return new Promise((resolve) => {
    const key = process.env.TOGETHER_AI_API_KEY || process.env.TOGETHER_API_KEY || "";
    if (!key) { resolve({ success: false, error: "No API key" }); return; }

    // Strip data: prefix if present
    const b64 = imageB64.replace(/^data:image\/[a-z]+;base64,/, "");

    const body = JSON.stringify({
      model: "meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Extract the interview question, coding problem, or technical task from this screenshot. Include any visible code. If nothing found, return: NONE. Return only extracted text, nothing else." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } }
        ]
      }]
    });

    const req = https.request({
      hostname: "api.together.xyz",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      }
    }, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => { data += c; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed?.choices?.[0]?.message?.content?.trim() || "";
          resolve({ success: true, text: text === "NONE" ? "" : text });
        } catch {
          resolve({ success: false, error: "Parse error" });
        }
      });
    });
    req.on("error", (e: Error) => resolve({ success: false, error: e.message }));
    req.write(body);
    req.end();
  });
}

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
    // ✅ Taskbar + Alt+Tab se bhi 100% hidden
    skipTaskbar: true,
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

  // ✅ Title blank — process scanner se identity hide
  mainWindow.setTitle("");

  // ✅ Screen recording me nahi dikhega (OBS, AnyDesk, TeamViewer, Zoom share)
  mainWindow.setContentProtection(true);

  // ✅ screen-saver level = sabse upar, fullscreen apps ke bhi upar
  mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // ✅ Shuruat me mouse events allow (taaki drag ho sake)
  mainWindow.setIgnoreMouseEvents(false);

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  // ── IPC handlers ──────────────────────────────────────────────────────────

  ipcMain.on("start-drag", (_event, dx: number, dy: number) => {
    if (!mainWindow || isLocked) return;
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x + dx, y + dy);
  });

  ipcMain.handle("toggle-lock", () => {
    isLocked = !isLocked;
    mainWindow?.setIgnoreMouseEvents(isLocked, { forward: true });
    return isLocked;
  });

  ipcMain.handle("get-lock-state", () => isLocked);
  ipcMain.on("close-app", () => { mainWindow?.destroy(); app.quit(); });
  ipcMain.on("minimize-app", () => mainWindow?.minimize());

  ipcMain.on("resize-window", (_event, height: number) => {
    if (mainWindow) {
      const [w] = mainWindow.getSize();
      mainWindow.setSize(w, Math.min(Math.max(height, 200), 900), true);
    }
  });

  // ✅ REAL AI call — main process se, key renderer ko kabhi nahi jaati
  ipcMain.handle("send-to-backend", async (event, payload: any) => {
    return await streamFromTogetherAI(payload, event);
  });

  // ✅ REAL vision extraction
  ipcMain.handle("vision-extract", async (_event, imageB64: string) => {
    return await extractFromScreenshot(imageB64);
  });

  // ── Screen capture ────────────────────────────────────────────────────────
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

  // ── Stealth Input IPC ─────────────────────────────────────────────────────
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

  // ── Mic permission (macOS) ────────────────────────────────────────────────
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

// ─── Global shortcuts ─────────────────────────────────────────────────────────
function registerShortcuts(): void {
  // Toggle visibility
  globalShortcut.register("CommandOrControl+Shift+O", () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus());
  });

  // OCR
  globalShortcut.register("CommandOrControl+Shift+S", () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.webContents.send("trigger-ocr");
  });

  // Stealth input
  globalShortcut.register("CommandOrControl+Shift+I", () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.webContents.send("show-stealth-input");
  });

  // Audio toggle
  globalShortcut.register("CommandOrControl+Shift+A", () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.webContents.send("toggle-audio");
  });

  // Panic hide
  globalShortcut.register("Escape", () => {
    mainWindow?.hide();
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  registerShortcuts();
  if (process.platform === "darwin") {
    app.dock?.hide();
  }
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
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
