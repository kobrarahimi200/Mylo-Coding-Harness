import type { ModusApi } from "../../../preload/types";

/** The renderer is a desktop client: never substitute an in-memory workspace API. */
export function requireDesktopBridge(api: ModusApi | undefined): ModusApi {
  if (
    !api ||
    typeof api.workspace?.open !== "function" ||
    typeof api.workspace?.list !== "function" ||
    typeof api.agent?.list !== "function" ||
    typeof api.agent?.onEvent !== "function" ||
    typeof api.model?.settings !== "function"
  ) {
    throw new Error(
      "The Electron preload bridge did not load. Launch Mylo with npm run dev or the installed desktop app; the renderer URL alone cannot access projects. Check the main-process preload-error log if this occurs inside Electron.",
    );
  }
  return api;
}
