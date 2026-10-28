import { app, type BrowserWindow as BrowserWindowType } from "electron";
import { getModelRuntime } from "./agent/model-service";
import { shutdownAgentRuntime } from "./agent/runtime-registry";
import { registerAppIpc } from "./ipc/register-app-ipc";
import { importDesktopData } from "./preferences/import-desktop-data";
import { createStartupTimeline } from "./startup/startup-timeline";
import { shutdownTerminals } from "./terminal/terminal-service";
import { createMainWindow } from "./windows/main-window";

let mainWindow: BrowserWindowType | null = null;
let ipcRegistered = false;
const startupTimeline = createStartupTimeline();

startupTimeline.mark("main.entry");

function boot(): void {
  if (!ipcRegistered) {
    registerAppIpc({ startupTimeline });
    ipcRegistered = true;
  }

  mainWindow = createMainWindow({ startupTimeline });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow && ipcRegistered) boot();
    if (!mainWindow) return;
    mainWindow.show();
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  });

  app
    .whenReady()
    .then(async () => {
      startupTimeline.mark("main.electron-ready");
      importDesktopData();
      await getModelRuntime().catch((error: unknown) =>
        console.error("Model configuration could not be loaded.", error),
      );
      boot();
    })
    .catch((error: unknown) => {
      console.error("Failed to boot Modus desktop.", error);
      app.exit(1);
    });

  app.on("activate", () => {
    if (!mainWindow && ipcRegistered) boot();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    shutdownTerminals();
    void shutdownAgentRuntime()
      .catch((error) => console.error("Failed to close agent sessions.", error))
      .finally(() => app.quit());
  });
}
