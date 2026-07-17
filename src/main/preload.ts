import { contextBridge, ipcRenderer } from "electron";
import type { TypingSpeedName } from "../shared/types";

contextBridge.exposeInMainWorld("electronAPI", {
  selectWorkspace: () => ipcRenderer.invoke("workspace:select"),
  loadPosts: (workspacePath: string) => ipcRenderer.invoke("posts:load", workspacePath),
  getLoginState: () => ipcRenderer.invoke("login:getState"),
  openManualLogin: () => ipcRenderer.invoke("login:openManual"),
  verifyLogin: () => ipcRenderer.invoke("login:verify"),
  clearSecurityHold: () => ipcRenderer.invoke("login:clearSecurityHold"),
  startRun: (workspacePath: string, speed: TypingSpeedName, maxPosts?: number | null) =>
    ipcRenderer.invoke("run:start", workspacePath, speed, maxPosts),
  stopRun: () => ipcRenderer.invoke("run:stop"),
  onRunLog: (callback: (message: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on("run:log", listener);
    return () => ipcRenderer.removeListener("run:log", listener);
  }
});
