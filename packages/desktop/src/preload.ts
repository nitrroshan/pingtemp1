/**
 * Preload Script — Exposes desktop-specific APIs to the renderer.
 *
 * Uses contextBridge for security (contextIsolation enabled).
 * The renderer can access these via window.ping.*
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ping", {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
  // Window controls
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
});
