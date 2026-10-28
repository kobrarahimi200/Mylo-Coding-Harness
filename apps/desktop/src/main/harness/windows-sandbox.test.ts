import { afterEach, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: Object.assign(vi.fn(), { [Symbol.for("nodejs.util.promisify.custom")]: execute }),
}));

import {
  cleanupWindowsSandbox,
  ensureWindowsSandbox,
  windowsSandboxInvocation,
} from "./windows-sandbox";

const id = "b2934201-a377-40e3-b286-198476acc6e5";
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

it("probes actual namespace availability, not just an installed WSL executable", async () => {
  execute.mockResolvedValue({ stdout: "MYLO_SANDBOX_READY", stderr: "" });
  await ensureWindowsSandbox();
  expect(execute).toHaveBeenCalledWith(
    "wsl.exe",
    expect.arrayContaining(["--exec", "/bin/sh"]),
    expect.objectContaining({ timeout: 15000 }),
  );
  const script = execute.mock.calls[0]?.[1][3];
  expect(script).toContain("/usr/bin/bwrap --unshare-all");
  expect(script).toContain("/usr/bin/setsid");
});

it.each([
  "spawn wsl.exe ENOENT",
  "No installed distributions",
  "Missing sandbox dependency: /usr/bin/bwrap",
  "Creating new namespace failed",
])("reports actionable setup errors: %s", async (failure) => {
  execute.mockRejectedValue(new Error(failure));
  await expect(ensureWindowsSandbox()).rejects.toThrow("wsl --install -d Ubuntu");
  await expect(ensureWindowsSandbox()).rejects.toThrow(failure);
});

it("does not accept an incomplete probe or forward provider secrets", async () => {
  vi.stubEnv("OPENAI_API_KEY", "fixture-secret");
  execute.mockResolvedValue({ stdout: "", stderr: "" });
  await expect(ensureWindowsSandbox()).rejects.toThrow("probe did not complete");
  expect(execute.mock.calls[0]?.[2].env).not.toHaveProperty("OPENAI_API_KEY");
});

it("passes drive paths, spaces, quotes, and commands as argv without shell interpolation", () => {
  const root = String.raw`C:\Projects\a project's $(touch sentinel)`;
  const invocation = windowsSandboxInvocation(root, "/bin/bash", ["-c", "npm test"], id);
  expect(invocation.args.slice(-4)).toEqual([root, "/bin/bash", "-c", "npm test"]);
  const script = invocation.args[3] ?? "";
  expect(script).not.toContain(root);
  expect(script).toContain('/usr/bin/wslpath -a -u "$1"');
  expect(script).toContain('--bind "$root" /workspace --chdir /workspace');
  expect(script).toContain("--clearenv");
  expect(script).toContain("--unshare-all");
  expect(script).not.toContain("--share-net");
  expect(script).toContain("--new-session");
});

it("cancels only the identified run's Linux process group, including startup races", async () => {
  execute.mockResolvedValue({ stdout: "", stderr: "" });
  await cleanupWindowsSandbox(id);
  const script = execute.mock.calls[0]?.[1][3];
  expect(script).toContain(`${id}`);
  expect(script).toContain('"$state.cancel"');
  expect(script).toContain('/bin/kill -KILL -- -"$pid"');
  expect(script).not.toContain("--terminate");
  await expect(cleanupWindowsSandbox("injected;command")).rejects.toThrow("identity");
});

it("forwards cancellation to the setup probe", async () => {
  const controller = new AbortController();
  controller.abort();
  execute.mockRejectedValue(new Error("aborted"));
  await expect(ensureWindowsSandbox(controller.signal)).rejects.toThrow("cancelled");
  expect(execute.mock.calls[0]?.[2].signal).toBe(controller.signal);
});
