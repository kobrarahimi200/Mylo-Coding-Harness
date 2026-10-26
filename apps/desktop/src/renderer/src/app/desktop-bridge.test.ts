import { expect, it } from "vitest";
import type { ModusApi } from "../../../preload/types";
import { requireDesktopBridge } from "./desktop-bridge";

it("reports a missing preload bridge before mounting workspace-dependent components", () => {
  expect(() => requireDesktopBridge(undefined)).toThrow("Electron preload bridge did not load");
});
it("accepts a real bridge with no selected workspace or sessions", () => {
  const api = {
    workspace: { open: async () => undefined, list: async () => [] },
    agent: { list: async () => [], onEvent: () => () => {} },
    model: { settings: async () => ({}) },
  } as unknown as ModusApi;
  expect(requireDesktopBridge(api)).toBe(api);
});
