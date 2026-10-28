import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { sandboxInvocation, sandboxOperations } from "./sandbox";

const root = mkdtempSync(join(tmpdir(), "mylo-sandbox-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
it("builds an OS sandbox invocation with only the workspace writable", () => {
  const invocation = sandboxInvocation(root, "/bin/bash", ["-c", "echo test"], "darwin");
  expect(invocation.executable).toBe("/usr/bin/sandbox-exec");
  expect(invocation.args[1]).toContain("(deny default)");
  expect(invocation.args[1]).toContain("(allow file-read* file-write* (subpath");
  expect(invocation.args[1]).not.toContain("network*");
  expect(invocation.args.slice(-3)).toEqual(["/bin/bash", "-c", "echo test"]);
});
it("fails closed when there is no supported isolation backend", () => {
  expect(() => sandboxInvocation(root, "powershell", [], "freebsd")).toThrow(
    "execution is blocked",
  );
});

it("runs Windows commands through WSL and bubblewrap without exposing host mounts", () => {
  const invocation = sandboxInvocation(root, "/bin/bash", ["-c", "npm test"], "win32");
  expect(invocation.executable).toBe("wsl.exe");
  expect(invocation.args.join(" ")).toContain("--unshare-all");
  expect(invocation.args.join(" ")).toContain('--bind "$root" /workspace');
  expect(invocation.args).toContain(realpathSync(root));
});

it.runIf(process.platform === "darwin")(
  "reports a real subprocess timeout instead of an ambiguous null exit",
  async () => {
    await expect(
      sandboxOperations(root).exec("/bin/sleep 10", root, { timeout: 0.05, onData: () => {} }),
    ).rejects.toThrow("timed out");
  },
);

it.runIf(process.platform === "darwin")(
  "cancels a running subprocess and rejects an already-cancelled launch",
  async () => {
    const controller = new AbortController();
    const command = sandboxOperations(root).exec("echo ready; /bin/sleep 10", root, {
      timeout: 5,
      signal: controller.signal,
      onData: (chunk) => {
        if (chunk.toString().includes("ready")) controller.abort();
      },
    });
    await expect(command).rejects.toThrow("cancelled");
    await expect(
      sandboxOperations(root).exec("touch should-not-run", root, {
        signal: controller.signal,
        onData: () => {},
      }),
    ).rejects.toThrow("cancelled");
  },
);
