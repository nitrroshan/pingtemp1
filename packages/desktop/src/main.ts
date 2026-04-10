/**
 * Ping Desktop — Electron Main Process
 *
 * Responsibilities:
 * 1. Spawn backend server as UtilityProcess
 * 2. Create BrowserWindow for React frontend
 * 3. System tray, menus, lifecycle
 * 4. Auto-updates
 */

import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  shell,
} from "electron";
import path from "path";
import http from "http";
import { spawn, ChildProcess } from "child_process";
import { setupUpdater } from "./updater.js";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let backendChild: ChildProcess | null = null;

const BACKEND_PORT = 3002;
const isDev = !app.isPackaged;

// Fix for black screen with custom title bar on some Windows GPU configs
// VS Code uses the same workaround
app.commandLine.appendSwitch("disable-gpu-compositing");

function getIconPath(): string {
  const iconsDir = path.join(__dirname, "..", "resources", "icons");
  if (process.platform === "win32") return path.join(iconsDir, "win", "icon.ico");
  if (process.platform === "darwin") return path.join(iconsDir, "mac", "icon.icns");
  return path.join(iconsDir, "png", "256x256.png");
}

// ═══════════════════════════════════════════════════════════════
// BACKEND
// ═══════════════════════════════════════════════════════════════

/**
 * Check if the backend is already responding on the expected port.
 */
function checkBackendAlive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

/**
 * Poll until the backend responds on the given port.
 */
function waitForBackend(port: number, timeoutMs: number = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function poll() {
      checkBackendAlive(port).then((alive) => {
        if (alive) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error("Backend did not start in time"));
        setTimeout(poll, 400);
      });
    }
    poll();
  });
}

function startBackend(): Promise<void> {
  return new Promise(async (resolve, reject) => {
    // In dev mode, check if backend is already running externally (bun run dev:backend)
    if (isDev) {
      const alive = await checkBackendAlive(BACKEND_PORT);
      if (alive) {
        console.log("[desktop] Dev backend already running on port", BACKEND_PORT);
        resolve();
        return;
      }
    }

    const dataDir = isDev
      ? path.join(process.cwd(), "data")
      : path.join(app.getPath("userData"), "data");

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      API_PORT: String(BACKEND_PORT),
      DATA_DIR: dataDir,
      COLLAB_STORAGE_DIR: path.join(dataDir, "collab"),
      NODE_ENV: isDev ? "development" : "production",
      LOCAL_FIRST: "true",
    };

    let serverEntry: string;
    let runtimeBin: string;
    let runtimeArgs: string[];
    let cwd: string;

    if (isDev) {
      // Dev: use bun to run the tsc-compiled backend (handles .ts workspace imports)
      const backendRoot = path.resolve(__dirname, "..", "..", "backend");
      serverEntry = path.join(backendRoot, "dist", "server.js");
      runtimeBin = "bun";
      runtimeArgs = ["run", serverEntry];
      cwd = backendRoot;
    } else {
      // Production: use Electron's Node.js to run the esbuild-bundled backend
      serverEntry = path.join(process.resourcesPath, "backend-bundle.js");
      runtimeBin = process.execPath;
      runtimeArgs = [serverEntry];
      cwd = path.dirname(serverEntry);
      // Electron needs this flag to run as plain Node
      env.ELECTRON_RUN_AS_NODE = "1";
      // Vendored node_modules for backend deps
      env.NODE_PATH = path.join(process.resourcesPath, "node_modules");
    }

    console.log(`[desktop] Starting backend: ${serverEntry}`);
    console.log(`[desktop] Runtime: ${runtimeBin}`);
    console.log(`[desktop] Data dir: ${dataDir}`);

    backendChild = spawn(runtimeBin, runtimeArgs, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    backendChild.stdout?.on("data", (chunk: Buffer) => {
      try { process.stdout.write(`[backend] ${chunk}`); } catch { /* EPIPE — child died */ }
    });
    backendChild.stderr?.on("data", (chunk: Buffer) => {
      try { process.stderr.write(`[backend:err] ${chunk}`); } catch { /* EPIPE */ }
    });

    backendChild.on("exit", (code) => {
      console.log(`[desktop] Backend exited with code ${code}`);
      backendChild = null;
    });

    // Wait for backend to become responsive
    try {
      await waitForBackend(BACKEND_PORT);
      console.log("[desktop] Backend ready");
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

function stopBackend() {
  if (backendChild) {
    backendChild.kill();
    backendChild = null;
  }
}

// ═══════════════════════════════════════════════════════════════
// WINDOW
// ═══════════════════════════════════════════════════════════════

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "Ping",
    icon: getIconPath(),
    backgroundColor: "#0a0a0a",
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    // Dev: load Vite dev server
    mainWindow.loadURL("http://localhost:3000");
  } else {
    // Production: load built frontend from resources
    const frontendPath = path.join(process.resourcesPath, "frontend", "index.html");
    mainWindow.loadFile(frontendPath);
  }

  // Only open devtools in dev
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "bottom" });
  }

  // Log load errors
  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    console.error(`Failed to load: ${code} ${desc}`);
  });

  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("Renderer crashed:", details);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

// ═══════════════════════════════════════════════════════════════
// TRAY
// ═══════════════════════════════════════════════════════════════

function createTray() {
  const iconPath = path.join(__dirname, "..", "resources", "icons", "png", "32x32.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: "Open Ping", click: () => mainWindow?.show() || createWindow() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);

  tray.setToolTip("Ping — AI Agent Orchestration");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => mainWindow?.show() || createWindow());
}

// ═══════════════════════════════════════════════════════════════
// MENU
// ═══════════════════════════════════════════════════════════════

function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About Ping",
          click: () => {
            const { dialog } = require("electron");
            dialog.showMessageBox({
              type: "info",
              title: "About Ping",
              message: `Ping Desktop v${app.getVersion()}`,
              detail: "AI Agent Orchestration Platform",
            });
          },
        },
      ],
    },
  ];

  // macOS app menu
  if (process.platform === "darwin") {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ═══════════════════════════════════════════════════════════════
// APP LIFECYCLE
// ═══════════════════════════════════════════════════════════════

app.whenReady().then(async () => {
  createMenu();

  // IPC handlers for custom window controls
  ipcMain.on("window:minimize", () => mainWindow?.minimize());
  ipcMain.on("window:maximize", () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on("window:close", () => mainWindow?.close());

  try {
    await startBackend();
    console.log("Backend ready");
  } catch (err) {
    console.error("Failed to start backend:", err);
    app.quit();
    return;
  }

  createWindow();
  createTray();

  if (app.isPackaged) {
    setupUpdater();
  }
});

app.on("window-all-closed", () => {
  // On macOS, keep app in dock until explicitly quit
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On macOS, re-create window when dock icon clicked
  if (mainWindow === null) {
    createWindow();
  }
});

app.on("before-quit", () => {
  stopBackend();
});
