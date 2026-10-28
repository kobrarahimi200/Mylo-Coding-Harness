import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { BrowserWindow } from "electron";
import { afterAll, expect, it, vi } from "vitest";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("electron", () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
}));

import { createTerminal, listTerminals, removeTerminal } from "./terminal-service";

const root = mkdtempSync(join(tmpdir(), "mylo-terminal-errors-"));
const binary = join(root, "host");
writeFileSync(binary, "");
const original = process.env.MODUS_PTY_HOST_PATH;
process.env.MODUS_PTY_HOST_PATH = binary;
afterAll(() => {
  if (original === undefined) delete process.env.MODUS_PTY_HOST_PATH;
  else process.env.MODUS_PTY_HOST_PATH = original;
  rmSync(root, { recursive: true, force: true });
});
function host() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
    killed: false,
  });
}
const events: unknown[] = [];
const window = {
  isDestroyed: () => false,
  webContents: { send: (_channel: string, event: unknown) => events.push(event) },
} as unknown as BrowserWindow;

it("surfaces a native PTY launch error without an unhandled main-process exception", () => {
  const child = host();
  spawn.mockReturnValue(child);
  const terminal = createTerminal(window, { workspaceId: "fixture", cwd: root });
  child.emit("error", new Error("spawn ENOEXEC"));
  expect(listTerminals().find((t) => t.id === terminal.id)).toMatchObject({
    status: "exited",
    exitCode: 1,
  });
  expect(events).toContainEqual(
    expect.objectContaining({ type: "terminal.data", data: expect.stringContaining("ENOEXEC") }),
  );
  removeTerminal(terminal.id);
});

it("reports malformed host output and can start a replacement host", () => {
  const child = host();
  spawn.mockReturnValue(child);
  const terminal = createTerminal(window, { workspaceId: "fixture", cwd: root });
  child.stdout.write("not-json\n");
  expect(child.kill).toHaveBeenCalledOnce();
  expect(listTerminals().find((t) => t.id === terminal.id)?.status).toBe("exited");
  removeTerminal(terminal.id);
  const replacement = host();
  spawn.mockReturnValue(replacement);
  const next = createTerminal(window, { workspaceId: "fixture", cwd: root });
  child.emit("exit", 1);
  child.emit("error", new Error("late error from replaced host"));
  expect(listTerminals().find((t) => t.id === next.id)?.status).toBe("running");
  replacement.emit("exit", 0);
  removeTerminal(next.id);
});
